/* eslint-disable max-lines -- issue CRUD + search + labels + description handling form a single domain */
/**
 * Issue domain operations for Huly MCP server.
 *
 * Provides typed operations for querying issues from Huly platform.
 * Operations use HulyClient service and return typed domain objects.
 *
 * @module
 */
import type { Person } from "@hcengineering/contact"
import {
  type AttachedData,
  type Class,
  type Data,
  type Doc,
  type DocumentQuery,
  type DocumentUpdate,
  generateId,
  type MarkupBlobRef,
  type Ref,
  SortingOrder,
  type Space,
  type Status,
  type WithLookup
} from "@hcengineering/core"
import { makeRank } from "@hcengineering/rank"
import type { TagElement, TagReference } from "@hcengineering/tags"
import { type Issue as HulyIssue, type IssueParentInfo, type Project as HulyProject } from "@hcengineering/tracker"
import { Effect, Schema } from "effect"

import type {
  AddLabelParams,
  CreateIssueParams,
  DeleteIssueParams,
  GetIssueParams,
  Issue,
  IssueSummary,
  ListIssuesParams,
  MoveIssueParams,
  UpdateIssueParams
} from "../../domain/schemas.js"
import type {
  AddLabelResult,
  CreateIssueResult,
  DeleteIssueResult,
  MoveIssueResult,
  UpdateIssueResult
} from "../../domain/schemas/issues.js"
import {
  IssueId,
  IssueIdentifier,
  NonNegativeNumber,
  PersonId,
  PersonName,
  StatusName
} from "../../domain/schemas/shared.js"
import { normalizeForComparison } from "../../utils/normalize.js"
import type { HulyClient, HulyClientError } from "../client.js"
import type { ComponentNotFoundError, ProjectNotFoundError } from "../errors.js"
import { InvalidStatusError, IssueNotFoundError, PersonNotFoundError } from "../errors.js"
import { contact, core, tags, tracker } from "../huly-plugins.js"
import { findComponentByIdOrLabel } from "./components.js"
import { escapeLikeWildcards, withLookup } from "./query-helpers.js"
import {
  clampLimit,
  findIssueInProject,
  findPersonByEmailOrName,
  findProject,
  findProjectAndIssue,
  findProjectWithStatuses,
  parseIssueIdentifier,
  priorityToString,
  type StatusInfo,
  stringToPriority,
  toRef,
  zeroAsUnset
} from "./shared.js"

type ListIssuesError =
  | HulyClientError
  | ProjectNotFoundError
  | IssueNotFoundError
  | InvalidStatusError
  | ComponentNotFoundError

type GetIssueError =
  | HulyClientError
  | ProjectNotFoundError
  | IssueNotFoundError

type CreateIssueError =
  | HulyClientError
  | ProjectNotFoundError
  | IssueNotFoundError
  | InvalidStatusError
  | PersonNotFoundError

type UpdateIssueError =
  | HulyClientError
  | ProjectNotFoundError
  | IssueNotFoundError
  | InvalidStatusError
  | PersonNotFoundError

type AddLabelError =
  | HulyClientError
  | ProjectNotFoundError
  | IssueNotFoundError

type MoveIssueError =
  | HulyClientError
  | ProjectNotFoundError
  | IssueNotFoundError

type DeleteIssueError =
  | HulyClientError
  | ProjectNotFoundError
  | IssueNotFoundError

// SDK: updateDoc with retrieve=true returns TxResult which doesn't type the embedded object.
// The runtime value includes { object: { sequence: number } } for $inc operations.
const TxIncResult = Schema.Struct({
  object: Schema.Struct({
    sequence: Schema.Number
  })
})

const extractUpdatedSequence = (txResult: unknown): number | undefined => {
  const decoded = Schema.decodeUnknownOption(TxIncResult)(txResult)
  return decoded._tag === "Some" ? decoded.value.object.sequence : undefined
}

// --- Helpers: resolveStatusByName, resolveAssignee ---

const resolveStatusByName = (
  statuses: Array<StatusInfo>,
  statusName: string,
  project: string
): Effect.Effect<Ref<Status>, InvalidStatusError> => {
  const normalizedInput = normalizeForComparison(statusName)
  const matchingStatus = statuses.find(
    s => normalizeForComparison(s.name) === normalizedInput
  )
  if (matchingStatus === undefined) {
    return Effect.fail(new InvalidStatusError({ status: statusName, project }))
  }
  return Effect.succeed(matchingStatus._id)
}

const resolveAssignee = (
  client: HulyClient["Type"],
  assigneeIdentifier: string
): Effect.Effect<Person, PersonNotFoundError | HulyClientError> =>
  Effect.gen(function*() {
    const person = yield* findPersonByEmailOrName(client, assigneeIdentifier)
    if (person === undefined) {
      return yield* new PersonNotFoundError({ identifier: assigneeIdentifier })
    }
    return person
  })

const resolveStatusName = (
  statuses: Array<StatusInfo>,
  statusId: Ref<Status>
): string => {
  const statusDoc = statuses.find(s => s._id === statusId)
  return statusDoc?.name ?? "Unknown"
}

// --- Operations ---

/**
 * List issues with filters.
 * Results sorted by modifiedOn descending.
 */
export const listIssues = (
  params: ListIssuesParams
): Effect.Effect<Array<IssueSummary>, ListIssuesError, HulyClient> =>
  Effect.gen(function*() {
    const { client, project, statuses } = yield* findProjectWithStatuses(params.project)

    const query: DocumentQuery<HulyIssue> = {
      space: project._id
    }

    if (params.status !== undefined) {
      const statusFilter = normalizeForComparison(params.status)

      if (statusFilter === "open") {
        const doneAndCanceledStatuses = statuses
          .filter(s => s.isDone || s.isCanceled)
          .map(s => s._id)

        if (doneAndCanceledStatuses.length > 0) {
          query.status = { $nin: doneAndCanceledStatuses }
        }
      } else if (statusFilter === "done") {
        const doneStatuses = statuses
          .filter(s => s.isDone)
          .map(s => s._id)

        if (doneStatuses.length > 0) {
          query.status = { $in: doneStatuses }
        } else {
          return []
        }
      } else if (statusFilter === "canceled") {
        const canceledStatuses = statuses
          .filter(s => s.isCanceled)
          .map(s => s._id)

        if (canceledStatuses.length > 0) {
          query.status = { $in: canceledStatuses }
        } else {
          return []
        }
      } else {
        query.status = yield* resolveStatusByName(statuses, params.status, params.project)
      }
    }

    if (params.assignee !== undefined) {
      const assigneePerson = yield* findPersonByEmailOrName(client, params.assignee)
      if (assigneePerson !== undefined) {
        query.assignee = assigneePerson._id
      } else {
        return []
      }
    }

    // Apply title search using $like operator
    if (params.titleSearch !== undefined && params.titleSearch.trim() !== "") {
      query.title = { $like: `%${escapeLikeWildcards(params.titleSearch)}%` }
    }

    if (params.descriptionSearch !== undefined && params.descriptionSearch.trim() !== "") {
      query.$search = params.descriptionSearch
    }

    if (params.parentIssue !== undefined) {
      const parentIssue = yield* findIssueInProject(client, project, params.parentIssue)
      query.attachedTo = parentIssue._id
    }

    if (params.component !== undefined) {
      const component = yield* findComponentByIdOrLabel(client, project._id, params.component)
      if (component !== undefined) {
        query.component = component._id
      } else {
        return []
      }
    }

    const limit = clampLimit(params.limit)

    type IssueWithLookup = WithLookup<HulyIssue> & {
      $lookup?: { assignee?: Person }
    }

    const issues = yield* client.findAll<IssueWithLookup>(
      tracker.class.Issue,
      query,
      withLookup<IssueWithLookup>(
        {
          limit,
          sort: {
            modifiedOn: SortingOrder.Descending
          }
        },
        { assignee: contact.class.Person }
      )
    )

    const summaries: Array<IssueSummary> = []
    for (const issue of issues) {
      const statusName = resolveStatusName(statuses, issue.status)
      const assigneeName = issue.$lookup?.assignee?.name
      const directParent = issue.parents.length > 0
        ? issue.parents[issue.parents.length - 1]
        : undefined

      summaries.push({
        identifier: IssueIdentifier.make(issue.identifier),
        title: issue.title,
        status: StatusName.make(statusName),
        priority: priorityToString(issue.priority),
        assignee: assigneeName !== undefined ? PersonName.make(assigneeName) : undefined,
        parentIssue: directParent !== undefined ? IssueIdentifier.make(directParent.identifier) : undefined,
        subIssues: issue.subIssues > 0 ? issue.subIssues : undefined,
        modifiedOn: issue.modifiedOn
      })
    }

    return summaries
  })

/**
 * Get a single issue with full details.
 *
 * Looks up issue by identifier (e.g., "HULY-123" or just 123).
 * Returns full issue including:
 * - Description rendered as markdown
 * - Assignee name (not just ID)
 * - Status name
 * - All metadata
 */
export const getIssue = (
  params: GetIssueParams
): Effect.Effect<Issue, GetIssueError, HulyClient> =>
  Effect.gen(function*() {
    const { client, project, statuses } = yield* findProjectWithStatuses(params.project)

    const { fullIdentifier, number } = parseIssueIdentifier(params.identifier, params.project)

    const issue = (yield* client.findOne<HulyIssue>(
      tracker.class.Issue,
      { space: project._id, identifier: fullIdentifier }
    )) ?? (number !== null
      ? yield* client.findOne<HulyIssue>(
        tracker.class.Issue,
        { space: project._id, number }
      )
      : undefined)
    if (issue === undefined) {
      return yield* new IssueNotFoundError({ identifier: params.identifier, project: params.project })
    }

    const statusName = resolveStatusName(statuses, issue.status)

    type AssigneeInfo = { assigneeName: string | undefined; assigneeRef: Issue["assigneeRef"] }
    const noAssignee: AssigneeInfo = { assigneeName: undefined, assigneeRef: undefined }
    const issueAssignee = issue.assignee
    const { assigneeName, assigneeRef }: AssigneeInfo = issueAssignee !== null
      ? yield* Effect.gen(function*() {
        const person = yield* client.findOne<Person>(
          contact.class.Person,
          { _id: issueAssignee }
        )
        if (person) {
          const ref: Issue["assigneeRef"] = {
            id: PersonId.make(person._id),
            name: PersonName.make(person.name)
          }
          return { assigneeName: person.name, assigneeRef: ref }
        }
        return noAssignee
      })
      : noAssignee

    const description = issue.description
      ? yield* client.fetchMarkup(
        issue._class,
        issue._id,
        "description",
        issue.description,
        "markdown"
      )
      : undefined

    const directParent = issue.parents.length > 0
      ? issue.parents[issue.parents.length - 1]
      : undefined

    const result: Issue = {
      identifier: IssueIdentifier.make(issue.identifier),
      title: issue.title,
      description,
      status: StatusName.make(statusName),
      priority: priorityToString(issue.priority),
      assignee: assigneeName !== undefined ? PersonName.make(assigneeName) : undefined,
      assigneeRef,
      project: params.project,
      parentIssue: directParent !== undefined ? IssueIdentifier.make(directParent.identifier) : undefined,
      subIssues: issue.subIssues > 0 ? issue.subIssues : undefined,
      modifiedOn: issue.modifiedOn,
      createdOn: issue.createdOn,
      dueDate: issue.dueDate ?? undefined,
      estimation: zeroAsUnset(NonNegativeNumber.make(issue.estimation))
    }

    return result
  })

// --- Create Issue Operation ---

/**
 * Create a new issue in a project.
 *
 * Creates issue with:
 * - Title (required)
 * - Description (optional, markdown supported)
 * - Priority (optional, defaults to no-priority)
 * - Status (optional, uses project default)
 * - Assignee (optional, by email or name)
 */
export const createIssue = (
  params: CreateIssueParams
): Effect.Effect<CreateIssueResult, CreateIssueError, HulyClient> =>
  Effect.gen(function*() {
    const result = params.status !== undefined
      ? yield* findProjectWithStatuses(params.project)
      : yield* Effect.map(findProject(params.project), ({ client, project }) => ({
        client,
        project,
        statuses: []
      }))

    const { client, project, statuses } = result

    const issueId: Ref<HulyIssue> = generateId()

    const incOps: DocumentUpdate<HulyProject> = { $inc: { sequence: 1 } }
    const incResult = yield* client.updateDoc(
      tracker.class.Project,
      toRef<Space>("core:space:Space"),
      project._id,
      incOps,
      true
    )
    const sequence = extractUpdatedSequence(incResult) ?? project.sequence + 1

    const statusRef: Ref<Status> = params.status !== undefined
      ? yield* resolveStatusByName(statuses, params.status, params.project)
      : project.defaultIssueStatus

    const assigneeRef: Ref<Person> | null = params.assignee !== undefined
      ? (yield* resolveAssignee(client, params.assignee))._id
      : null

    const lastIssue = yield* client.findOne<HulyIssue>(
      tracker.class.Issue,
      { space: project._id },
      { sort: { rank: SortingOrder.Descending } }
    )
    const rank = makeRank(lastIssue?.rank, undefined)

    const descriptionMarkupRef: MarkupBlobRef | null =
      params.description !== undefined && params.description.trim() !== ""
        ? yield* client.uploadMarkup(
          tracker.class.Issue,
          issueId,
          "description",
          params.description,
          "markdown"
        )
        : null

    const priority = stringToPriority(params.priority || "no-priority")
    const identifier = `${project.identifier}-${sequence}`

    const parentIssueParam = params.parentIssue
    const { attachedTo, attachedToClass, collection, parents } = parentIssueParam !== undefined
      ? yield* Effect.gen(function*() {
        const parentIssue = yield* findIssueInProject(client, project, parentIssueParam)
        return {
          attachedTo: parentIssue._id as Ref<Doc>,
          attachedToClass: tracker.class.Issue as Ref<Class<Doc>>,
          collection: "subIssues" as const,
          parents: [
            ...parentIssue.parents,
            {
              parentId: parentIssue._id,
              identifier: parentIssue.identifier,
              parentTitle: parentIssue.title,
              space: project._id
            }
          ]
        }
      })
      : {
        attachedTo: project._id as Ref<Doc>,
        attachedToClass: tracker.class.Project as Ref<Class<Doc>>,
        collection: "issues" as const,
        parents: [] as Array<IssueParentInfo>
      }

    const issueData: AttachedData<HulyIssue> = {
      title: params.title,
      description: descriptionMarkupRef,
      status: statusRef,
      number: sequence,
      kind: tracker.taskTypes.Issue,
      identifier,
      priority,
      assignee: assigneeRef,
      component: null,
      estimation: 0,
      remainingTime: 0,
      reportedTime: 0,
      reports: 0,
      subIssues: 0,
      parents,
      childInfo: [],
      dueDate: null,
      rank
    }
    yield* client.addCollection(
      tracker.class.Issue,
      project._id,
      attachedTo,
      attachedToClass,
      collection,
      issueData,
      issueId
    )

    return { identifier: IssueIdentifier.make(identifier), issueId: IssueId.make(issueId) }
  })

// --- Update Issue Operation ---

/**
 * Update an existing issue in a project.
 *
 * Updates only provided fields:
 * - title: New title
 * - description: New markdown description (uploaded via uploadMarkup)
 * - status: New status (resolved by name)
 * - priority: New priority
 * - assignee: New assignee email/name, or null to unassign
 *
 * Note: Huly REST API is eventually consistent. Reads immediately after
 * updates may return stale data. Allow ~2 seconds for propagation.
 */
export const updateIssue = (
  params: UpdateIssueParams
): Effect.Effect<UpdateIssueResult, UpdateIssueError, HulyClient> =>
  Effect.gen(function*() {
    const { client, issue, project } = yield* findProjectAndIssue(params)

    const statuses: Array<StatusInfo> = params.status !== undefined
      ? (yield* findProjectWithStatuses(params.project)).statuses
      : []

    const updateOps: DocumentUpdate<HulyIssue> = {}
    let descriptionUpdatedInPlace = false

    if (params.title !== undefined) {
      updateOps.title = params.title
    }

    if (params.description !== undefined) {
      if (params.description.trim() === "") {
        updateOps.description = null
      } else if (issue.description) {
        // Issue already has description - update in place
        yield* client.updateMarkup(
          tracker.class.Issue,
          issue._id,
          "description",
          params.description,
          "markdown"
        )
        descriptionUpdatedInPlace = true
      } else {
        // Issue has no description yet - create new
        const descriptionMarkupRef = yield* client.uploadMarkup(
          tracker.class.Issue,
          issue._id,
          "description",
          params.description,
          "markdown"
        )
        updateOps.description = descriptionMarkupRef
      }
    }

    if (params.status !== undefined) {
      updateOps.status = yield* resolveStatusByName(statuses, params.status, params.project)
    }

    if (params.priority !== undefined) {
      updateOps.priority = stringToPriority(params.priority)
    }

    if (params.assignee !== undefined) {
      if (params.assignee === null) {
        updateOps.assignee = null
      } else {
        const person = yield* resolveAssignee(client, params.assignee)
        updateOps.assignee = person._id
      }
    }

    if (Object.keys(updateOps).length === 0 && !descriptionUpdatedInPlace) {
      return { identifier: IssueIdentifier.make(issue.identifier), updated: false }
    }

    if (Object.keys(updateOps).length > 0) {
      yield* client.updateDoc(
        tracker.class.Issue,
        project._id,
        issue._id,
        updateOps
      )
    }

    return { identifier: IssueIdentifier.make(issue.identifier), updated: true }
  })

// --- Add Label Operation ---

/**
 * Add a label/tag to an issue.
 *
 * Creates the tag in the project if it doesn't exist,
 * then attaches it to the issue via TagReference.
 *
 * Idempotent: adding the same label twice is a no-op.
 */
export const addLabel = (
  params: AddLabelParams
): Effect.Effect<AddLabelResult, AddLabelError, HulyClient> =>
  Effect.gen(function*() {
    const { client, issue, project } = yield* findProjectAndIssue(params)

    const existingLabels = yield* client.findAll<TagReference>(
      tags.class.TagReference,
      {
        attachedTo: issue._id,
        attachedToClass: tracker.class.Issue
      }
    )

    const labelTitle = params.label.trim()
    const labelExists = existingLabels.some(
      (l) => l.title.toLowerCase() === labelTitle.toLowerCase()
    )
    if (labelExists) {
      return { identifier: IssueIdentifier.make(issue.identifier), labelAdded: false }
    }

    const color = params.color ?? 0

    let tagElement = yield* client.findOne<TagElement>(
      tags.class.TagElement,
      {
        title: labelTitle,
        targetClass: toRef<Class<Doc>>(tracker.class.Issue)
      }
    )

    if (tagElement === undefined) {
      const tagElementId: Ref<TagElement> = generateId()
      const tagElementData: Data<TagElement> = {
        title: labelTitle,
        description: "",
        targetClass: toRef<Class<Doc>>(tracker.class.Issue),
        color,
        category: tracker.category.Other
      }
      yield* client.createDoc(
        tags.class.TagElement,
        toRef<Space>(core.space.Workspace),
        tagElementData,
        tagElementId
      )
      tagElement = yield* client.findOne<TagElement>(
        tags.class.TagElement,
        { _id: tagElementId }
      )
    }

    if (tagElement === undefined) {
      return { identifier: IssueIdentifier.make(issue.identifier), labelAdded: false }
    }

    const tagRefData: AttachedData<TagReference> = {
      title: tagElement.title,
      color: tagElement.color,
      tag: tagElement._id
    }
    yield* client.addCollection(
      tags.class.TagReference,
      project._id,
      issue._id,
      tracker.class.Issue,
      "labels",
      tagRefData
    )

    return { identifier: IssueIdentifier.make(issue.identifier), labelAdded: true }
  })

// --- Delete Issue Operation ---

/**
 * Delete an issue from a project.
 *
 * Permanently removes the issue. This operation cannot be undone.
 */
export const deleteIssue = (
  params: DeleteIssueParams
): Effect.Effect<DeleteIssueResult, DeleteIssueError, HulyClient> =>
  Effect.gen(function*() {
    const { client, issue, project } = yield* findProjectAndIssue(params)

    yield* client.removeDoc(
      tracker.class.Issue,
      project._id,
      issue._id
    )

    return { identifier: IssueIdentifier.make(issue.identifier), deleted: true }
  })

// --- Move Issue Operation ---

export const moveIssue = (
  params: MoveIssueParams
): Effect.Effect<MoveIssueResult, MoveIssueError, HulyClient> =>
  Effect.gen(function*() {
    const { client, issue, project } = yield* findProjectAndIssue(params)

    const oldParentIsIssue = issue.attachedToClass === tracker.class.Issue

    const newParentParam = params.newParent
    const { newAttachedTo, newAttachedToClass, newCollection, newParentIdentifier, newParents } =
      newParentParam !== null
        ? yield* Effect.gen(function*() {
          const parentIssue = yield* findIssueInProject(client, project, newParentParam)
          return {
            newAttachedTo: parentIssue._id as Ref<Doc>,
            newAttachedToClass: tracker.class.Issue as Ref<Class<Doc>>,
            newCollection: "subIssues" as const,
            newParents: [
              ...parentIssue.parents,
              {
                parentId: parentIssue._id,
                identifier: parentIssue.identifier,
                parentTitle: parentIssue.title,
                space: project._id
              }
            ],
            newParentIdentifier: parentIssue.identifier as string | undefined
          }
        })
        : {
          newAttachedTo: project._id as Ref<Doc>,
          newAttachedToClass: tracker.class.Project as Ref<Class<Doc>>,
          newCollection: "issues" as const,
          newParents: [] as Array<IssueParentInfo>,
          newParentIdentifier: undefined as string | undefined
        }

    // attachedTo is typed as Ref<Issue> in DocumentUpdate<HulyIssue>, but for top-level issues
    // it points to the project (Ref<Project>). Both are branded strings at runtime.
    const updateOps: DocumentUpdate<HulyIssue> = {
      attachedTo: toRef<HulyIssue>(newAttachedTo),
      attachedToClass: newAttachedToClass,
      collection: newCollection,
      parents: newParents
    }

    yield* client.updateDoc(
      tracker.class.Issue,
      project._id,
      issue._id,
      updateOps
    )

    // Update subIssues count on old parent (decrement) if it was an issue
    if (oldParentIsIssue) {
      yield* client.updateDoc(
        tracker.class.Issue,
        project._id,
        // issue.attachedTo is Ref<Doc>; for sub-issues it points to the parent issue.
        // Cast needed because updateDoc expects Ref<HulyIssue> but attachedTo is Ref<Doc>.
        toRef<HulyIssue>(issue.attachedTo),
        { $inc: { subIssues: -1 } }
      )
    }

    // Update subIssues count on new parent (increment) if it's an issue
    if (params.newParent !== null) {
      yield* client.updateDoc(
        tracker.class.Issue,
        project._id,
        toRef<HulyIssue>(newAttachedTo),
        { $inc: { subIssues: 1 } }
      )
    }

    // Update parents arrays on all descendant issues
    if (issue.subIssues > 0) {
      yield* updateDescendantParents(client, project._id, issue, newParents)
    }

    const result: MoveIssueResult = {
      identifier: IssueIdentifier.make(issue.identifier),
      moved: true
    }
    if (newParentIdentifier !== undefined) {
      return { ...result, newParent: IssueIdentifier.make(newParentIdentifier) }
    }
    return result
  })

const updateDescendantParents = (
  client: HulyClient["Type"],
  spaceId: Ref<HulyProject>,
  parentIssue: HulyIssue,
  parentNewParents: Array<IssueParentInfo>
): Effect.Effect<void, HulyClientError> =>
  Effect.gen(function*() {
    const thisParentInfo: IssueParentInfo = {
      parentId: parentIssue._id,
      identifier: parentIssue.identifier,
      parentTitle: parentIssue.title,
      space: spaceId
    }
    const children = yield* client.findAll<HulyIssue>(
      tracker.class.Issue,
      { attachedTo: parentIssue._id, space: spaceId }
    )
    for (const child of children) {
      const childNewParents = [...parentNewParents, thisParentInfo]
      yield* client.updateDoc(
        tracker.class.Issue,
        spaceId,
        child._id,
        { parents: childNewParents }
      )
      if (child.subIssues > 0) {
        yield* updateDescendantParents(client, spaceId, child, childNewParents)
      }
    }
  })
