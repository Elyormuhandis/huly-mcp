import { describe, it } from "@effect/vitest"
import type { Ref, Space, Status } from "@hcengineering/core"
import { toFindResult } from "@hcengineering/core"
import type { ProjectType, TaskType } from "@hcengineering/task"
import { Effect } from "effect"
import { expect } from "vitest"
import { HulyClient, type HulyClientOperations } from "../../../src/huly/client.js"
import { core, task } from "../../../src/huly/huly-plugins.js"
import { createStatus } from "../../../src/huly/operations/task-management.js"

const asProjectType = (v: unknown) => v as ProjectType
const asTaskTypes = (v: unknown) => v as Array<TaskType>

const IN_REVIEW = "status-in-review" as Ref<Status>
const IN_PROGRESS = "status-in-progress" as Ref<Status>
const ISSUE_TT = "tt-issue" as Ref<TaskType>
const BUG_TT = "tt-bug" as Ref<TaskType>
const PT_ID = "tracker:ids:ClassingProjectType"

interface Recorded {
  created: Array<{ id: unknown }>
  taskTypeUpdates: Array<{ id: unknown; statuses: Array<unknown> }>
  projectTypeUpdates: Array<{ statuses: Array<{ _id: unknown; taskType: unknown; color?: number }> }>
}

/**
 * Workspace where "In review" already exists and is attached to Issue only —
 * Bug lacks it. This is the real BHUB shape.
 */
const makeLayer = (rec: Recorded) => {
  const statuses = [
    { _id: IN_PROGRESS, name: "In progress", category: task.statusCategory.Active },
    { _id: IN_REVIEW, name: "In review", category: task.statusCategory.Active }
  ]
  const projectType = asProjectType({
    _id: PT_ID,
    space: "space-model" as Ref<Space>,
    tasks: [ISSUE_TT, BUG_TT],
    statuses: [
      { _id: IN_PROGRESS, color: 12, taskType: ISSUE_TT },
      { _id: IN_REVIEW, color: 6, taskType: ISSUE_TT },
      { _id: IN_PROGRESS, color: 12, taskType: BUG_TT }
    ]
  })
  const taskTypes = asTaskTypes([
    { _id: ISSUE_TT, name: "Issue", parent: PT_ID, space: "space-model", statuses: [IN_PROGRESS, IN_REVIEW] },
    { _id: BUG_TT, name: "Bug", parent: PT_ID, space: "space-model", statuses: [IN_PROGRESS] }
  ])

  const findAllImpl: HulyClientOperations["findAll"] = ((_class: unknown) => {
    if (_class === core.class.Status) return Effect.succeed(toFindResult(statuses as Array<never>))
    if (_class === task.class.TaskType) return Effect.succeed(toFindResult(taskTypes as Array<never>))
    return Effect.succeed(toFindResult([]))
  }) as HulyClientOperations["findAll"]

  const findOneImpl: HulyClientOperations["findOne"] = ((_class: unknown, query: unknown) => {
    if (_class === task.class.ProjectType) return Effect.succeed(projectType)
    if (_class === task.class.TaskType) {
      const q = query as Record<string, unknown>
      return Effect.succeed(taskTypes.find(t => t._id === q._id || t.name === q.name))
    }
    return Effect.succeed(undefined)
  }) as HulyClientOperations["findOne"]

  const createDocImpl = ((_class: unknown, _space: unknown, _data: unknown, id: unknown) => {
    rec.created.push({ id })
    return Effect.succeed(id)
  }) as HulyClientOperations["createDoc"]

  const updateDocImpl = ((_class: unknown, _space: unknown, id: unknown, ops: unknown) => {
    const o = ops as Record<string, unknown>
    if (_class === task.class.TaskType) {
      rec.taskTypeUpdates.push({ id, statuses: o.statuses as Array<unknown> })
    } else if (_class === task.class.ProjectType) {
      rec.projectTypeUpdates.push({
        statuses: o.statuses as Array<{ _id: unknown; taskType: unknown; color?: number }>
      })
    }
    return Effect.succeed({} as never)
  }) as HulyClientOperations["updateDoc"]

  return HulyClient.testLayer({
    findAll: findAllImpl,
    findOne: findOneImpl,
    createDoc: createDocImpl,
    updateDoc: updateDocImpl
  })
}

const emptyRec = (): Recorded => ({ created: [], taskTypeUpdates: [], projectTypeUpdates: [] })

describe("createStatus", () => {
  it.effect("attaches an EXISTING status to a task type instead of duplicating it", () =>
    Effect.gen(function*() {
      const rec = emptyRec()

      const result = yield* createStatus({
        name: "In review",
        category: "Active",
        taskType: "Bug"
      } as never).pipe(Effect.provide(makeLayer(rec)))

      // Reused, not created — a second "In review" doc would be indistinguishable.
      expect(rec.created).toHaveLength(0)
      expect(result.created).toBe(false)
      expect(result.id).toBe(IN_REVIEW)

      // Bug's TaskType.statuses gained the existing id.
      expect(rec.taskTypeUpdates).toHaveLength(1)
      expect(rec.taskTypeUpdates[0].id).toBe(BUG_TT)
      expect(rec.taskTypeUpdates[0].statuses).toEqual([IN_PROGRESS, IN_REVIEW])

      // ProjectType gained exactly the (In review, Bug) pair, carrying the color.
      expect(rec.projectTypeUpdates).toHaveLength(1)
      const added = rec.projectTypeUpdates[0].statuses.filter(
        e => e._id === IN_REVIEW && e.taskType === BUG_TT
      )
      expect(added).toHaveLength(1)
      expect(added[0].color).toBe(6)
    }))

  it.effect("is a no-op when the task type already has the status", () =>
    Effect.gen(function*() {
      const rec = emptyRec()

      const result = yield* createStatus({
        name: "In review",
        category: "Active",
        taskType: "Issue"
      } as never).pipe(Effect.provide(makeLayer(rec)))

      expect(result.created).toBe(false)
      expect(rec.created).toHaveLength(0)
      expect(rec.taskTypeUpdates).toHaveLength(0)
      expect(rec.projectTypeUpdates).toHaveLength(0)
    }))

  it.effect("still creates a genuinely new status", () =>
    Effect.gen(function*() {
      const rec = emptyRec()

      const result = yield* createStatus({
        name: "Brand new state",
        category: "Active",
        taskType: "Bug"
      } as never).pipe(Effect.provide(makeLayer(rec)))

      expect(rec.created).toHaveLength(1)
      expect(result.created).toBe(true)
      expect(rec.taskTypeUpdates).toHaveLength(1)
      expect(rec.projectTypeUpdates).toHaveLength(1)
    }))
})
