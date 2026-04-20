/**
 * Task/Project type management operations.
 *
 * Provides workspace-level operations for:
 * - Listing project types (ProjectType templates)
 * - Listing task types (issue types within a ProjectType)
 * - Creating new statuses (appended to both TaskType.statuses and ProjectType.statuses)
 * - Creating new task types (with copied statuses, appended to ProjectType.tasks)
 *
 * @module
 */
import type { Data, DocumentQuery, Ref, Space } from "@hcengineering/core"
import { generateId } from "@hcengineering/core"
import { makeRank } from "@hcengineering/rank"
import type { ProjectType, TaskType } from "@hcengineering/task"
import type { IssueStatus } from "@hcengineering/tracker"
import { Effect } from "effect"

import type {
  CreateStatusParams,
  CreateStatusResult,
  CreateTaskTypeParams,
  CreateTaskTypeResult,
  ListProjectTypesParams,
  ListProjectTypesResult,
  ListTaskTypesParams,
  ListTaskTypesResult,
  ProjectTypeId,
  StatusCategory,
  StatusId,
  TaskTypeId
} from "../../domain/schemas/task-management.js"
import { HulyClient, type HulyClientError } from "../client.js"
import { ProjectTypeNotFoundError, TaskTypeNotFoundError } from "../errors-task-management.js"
import { task, tracker } from "../huly-plugins.js"
import { clampLimit, toRef } from "./shared.js"

// Brand conversion helpers: Huly SDK uses Ref<T> (string brand), our domain uses Effect schema brand.
// The double-cast through unknown is the standard TypeScript pattern for bridging unrelated brand types.
// eslint-disable-next-line no-restricted-syntax -- see above
const asBranded = <B>(value: string): B => value as unknown as B

type ListProjectTypesError = HulyClientError
type ListTaskTypesError = HulyClientError | ProjectTypeNotFoundError
type CreateStatusError = HulyClientError | ProjectTypeNotFoundError | TaskTypeNotFoundError
type CreateTaskTypeError = HulyClientError | ProjectTypeNotFoundError | TaskTypeNotFoundError

const DEFAULT_PROJECT_TYPE_ID = "tracker:ids:ClassingProjectType"
const MODEL_SPACE: Ref<Space> = toRef<Space>("core:space:Model")

const CATEGORY_MAP: Record<StatusCategory, string> = {
  UnStarted: "task:statusCategory:UnStarted",
  ToDo: "task:statusCategory:ToDo",
  Active: "task:statusCategory:Active",
  Won: "task:statusCategory:Won",
  Lost: "task:statusCategory:Lost"
}

const findProjectType = (
  client: HulyClient["Type"],
  idOrName: string
): Effect.Effect<ProjectType | undefined, HulyClientError> =>
  Effect.gen(function*() {
    const byId = yield* client.findOne<ProjectType>(
      task.class.ProjectType,
      { _id: toRef<ProjectType>(idOrName) }
    )
    if (byId !== undefined) return byId
    return yield* client.findOne<ProjectType>(task.class.ProjectType, { name: idOrName })
  })

const findProjectTypeOrFail = (
  client: HulyClient["Type"],
  idOrName: string
): Effect.Effect<ProjectType, ProjectTypeNotFoundError | HulyClientError> =>
  Effect.gen(function*() {
    const pt = yield* findProjectType(client, idOrName)
    if (pt === undefined) {
      return yield* new ProjectTypeNotFoundError({ identifier: idOrName })
    }
    return pt
  })

const findTaskType = (
  client: HulyClient["Type"],
  idOrName: string,
  projectTypeId?: Ref<ProjectType>
): Effect.Effect<TaskType | undefined, HulyClientError> =>
  Effect.gen(function*() {
    const parentClause = projectTypeId !== undefined ? { parent: projectTypeId } : {}
    const byId = yield* client.findOne<TaskType>(task.class.TaskType, {
      _id: toRef<TaskType>(idOrName),
      ...parentClause
    })
    if (byId !== undefined) return byId
    return yield* client.findOne<TaskType>(task.class.TaskType, {
      name: idOrName,
      ...parentClause
    })
  })

// ---- List project types ----

export const listProjectTypes = (
  params: ListProjectTypesParams
): Effect.Effect<ListProjectTypesResult, ListProjectTypesError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient
    const limit = clampLimit(params.limit)
    const query: DocumentQuery<ProjectType> = params.descriptor !== undefined
      // eslint-disable-next-line no-restricted-syntax -- brand bridging at SDK boundary
      ? { descriptor: params.descriptor as unknown as ProjectType["descriptor"] }
      : {}
    const types = yield* client.findAll<ProjectType>(task.class.ProjectType, query, { limit })
    return {
      projectTypes: types.map((pt) => ({
        id: asBranded<ProjectTypeId>(pt._id),
        name: pt.name,
        descriptor: String(pt.descriptor),
        taskTypeIds: pt.tasks.map(asBranded<TaskTypeId>),
        statusCount: pt.statuses.length
      }))
    }
  })

// ---- List task types ----

export const listTaskTypes = (
  params: ListTaskTypesParams
): Effect.Effect<ListTaskTypesResult, ListTaskTypesError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient
    const limit = clampLimit(params.limit)
    const query: DocumentQuery<TaskType> = params.projectType !== undefined
      ? { parent: (yield* findProjectTypeOrFail(client, params.projectType))._id }
      : {}
    const types = yield* client.findAll<TaskType>(task.class.TaskType, query, { limit })
    return {
      taskTypes: types.map((tt) => ({
        id: asBranded<TaskTypeId>(tt._id),
        name: tt.name,
        projectTypeId: asBranded<ProjectTypeId>(tt.parent),
        statusCount: tt.statuses.length,
        ofClass: String(tt.ofClass)
      }))
    }
  })

// ---- Create status ----

export const createStatus = (
  params: CreateStatusParams
): Effect.Effect<CreateStatusResult, CreateStatusError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const projectTypeIdOrName = params.projectType ?? DEFAULT_PROJECT_TYPE_ID
    const pt = yield* findProjectTypeOrFail(client, projectTypeIdOrName)

    // Determine which task types receive the status
    const allTaskTypes = yield* client.findAll<TaskType>(task.class.TaskType, { parent: pt._id })
    let targetTaskTypes: Array<TaskType>
    if (params.taskType !== undefined) {
      const tt = yield* findTaskType(client, params.taskType, pt._id)
      if (tt === undefined) {
        return yield* new TaskTypeNotFoundError({ identifier: params.taskType })
      }
      targetTaskTypes = [tt]
    } else {
      targetTaskTypes = [...allTaskTypes]
    }

    if (targetTaskTypes.length === 0) {
      // No task types under the project type — nothing to attach to.
      return yield* new TaskTypeNotFoundError({
        identifier: `<any task type under ${projectTypeIdOrName}>`
      })
    }

    const categoryRef = CATEGORY_MAP[params.category]

    // Create the status doc (IssueStatus is in core:space:Model)
    const statusId: Ref<IssueStatus> = generateId()
    // eslint-disable-next-line no-restricted-syntax -- IssueStatus has SDK-internal required fields we intentionally omit (e.g., description is optional at runtime)
    const statusData = {
      ofAttribute: toRef(tracker.attribute.IssueStatus),
      name: params.name,
      category: toRef(categoryRef),
      rank: makeRank(undefined, undefined)
    } as unknown as Data<IssueStatus>

    yield* client.createDoc<IssueStatus>(
      tracker.class.IssueStatus,
      MODEL_SPACE,
      statusData,
      statusId
    )

    // Append to each target TaskType.statuses
    for (const tt of targetTaskTypes) {
      const newStatuses = [...tt.statuses, statusId]
      yield* client.updateDoc<TaskType>(task.class.TaskType, tt.space, tt._id, {
        statuses: newStatuses
      })
    }

    // Append to ProjectType.statuses (one entry per target task type)
    const newPtEntries = targetTaskTypes.map((tt) => ({ _id: statusId, taskType: tt._id }))
    yield* client.updateDoc<ProjectType>(task.class.ProjectType, pt.space, pt._id, {
      statuses: [...pt.statuses, ...newPtEntries]
    })

    return {
      id: asBranded<StatusId>(statusId),
      name: params.name,
      category: categoryRef,
      created: true,
      attachedTaskTypes: targetTaskTypes.map((t) => asBranded<TaskTypeId>(t._id))
    }
  })

// ---- Create task type ----

export const createTaskType = (
  params: CreateTaskTypeParams
): Effect.Effect<CreateTaskTypeResult, CreateTaskTypeError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const projectTypeIdOrName = params.projectType ?? DEFAULT_PROJECT_TYPE_ID
    const pt = yield* findProjectTypeOrFail(client, projectTypeIdOrName)

    // Idempotency: return existing if name matches within this project type.
    const existing = yield* client.findOne<TaskType>(task.class.TaskType, {
      parent: pt._id,
      name: params.name
    })
    if (existing !== undefined) {
      return {
        id: asBranded<TaskTypeId>(existing._id),
        name: existing.name,
        projectTypeId: asBranded<ProjectTypeId>(pt._id),
        statusCount: existing.statuses.length,
        created: false
      }
    }

    // Find template to copy from (default: first task type of this project type)
    const template: TaskType = yield* Effect.gen(function*() {
      if (params.templateTaskType !== undefined) {
        const found = yield* findTaskType(client, params.templateTaskType, pt._id)
        if (found === undefined) {
          return yield* new TaskTypeNotFoundError({ identifier: params.templateTaskType })
        }
        return found
      }
      const all = yield* client.findAll<TaskType>(task.class.TaskType, { parent: pt._id })
      if (all.length === 0) {
        return yield* new TaskTypeNotFoundError({
          identifier: `<any task type under ${pt._id}>`
        })
      }
      return all[0]
    })

    const newId: Ref<TaskType> = generateId()

    // eslint-disable-next-line no-restricted-syntax -- TaskType has SDK-internal optional fields we don't populate
    const newData = {
      parent: pt._id,
      descriptor: template.descriptor,
      name: params.name,
      kind: template.kind,
      ofClass: template.ofClass,
      targetClass: template.targetClass,
      statusClass: template.statusClass,
      statuses: [...template.statuses],
      statusCategories: [...template.statusCategories],
      allowedAsChildOf: template.allowedAsChildOf,
      icon: template.icon
    } as unknown as Data<TaskType>

    yield* client.createDoc<TaskType>(task.class.TaskType, MODEL_SPACE, newData, newId)

    // Update ProjectType: append new task type and its status refs
    const newPtStatusEntries = template.statuses.map((sid) => ({ _id: sid, taskType: newId }))
    yield* client.updateDoc<ProjectType>(task.class.ProjectType, pt.space, pt._id, {
      tasks: [...pt.tasks, newId],
      statuses: [...pt.statuses, ...newPtStatusEntries]
    })

    return {
      id: asBranded<TaskTypeId>(newId),
      name: params.name,
      projectTypeId: asBranded<ProjectTypeId>(pt._id),
      statusCount: template.statuses.length,
      created: true
    }
  })
