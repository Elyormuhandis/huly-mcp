/**
 * Issue read operations: list and get.
 *
 * @module
 */
import type { Person, SocialIdentity } from "@hcengineering/contact"
import {
  type DocumentQuery,
  type PersonId,
  type Ref,
  SortingOrder,
  type Status,
  type WithLookup
} from "@hcengineering/core"
import { type Issue as HulyIssue, type Milestone as HulyMilestone } from "@hcengineering/tracker"
import { Effect, Schema } from "effect"

import type { GetIssueParams, Issue, IssueSummary, ListIssuesParams } from "../../domain/schemas.js"
import { IssueSummarySchema, parseIssue } from "../../domain/schemas/issues.js"
import { normalizeForComparison } from "../../utils/normalize.js"
import type { HulyClient, HulyClientError } from "../client.js"
import type { ComponentNotFoundError, InvalidStatusError, ProjectNotFoundError } from "../errors.js"
import { HulyConnectionError, IssueNotFoundError } from "../errors.js"
import { contact, tracker } from "../huly-plugins.js"
import { buildSocialIdToPersonNameMap } from "./channels.js"
import { findComponentByIdOrLabel } from "./components.js"
import { escapeLikeWildcards, withLookup } from "./query-helpers.js"
import {
  clampLimit,
  findByNameOrId,
  findIssueInProject,
  findPersonByEmailOrName,
  findProjectWithStatuses,
  parseIssueIdentifier,
  priorityToString,
  resolveStatusByName,
  type StatusInfo,
  toRef
} from "./shared.js"

type ListIssuesError =
  | HulyClientError
  | HulyConnectionError
  | ProjectNotFoundError
  | IssueNotFoundError
  | InvalidStatusError
  | ComponentNotFoundError

type GetIssueError =
  | HulyClientError
  | HulyConnectionError
  | ProjectNotFoundError
  | IssueNotFoundError

const resolveStatusName = (
  statuses: Array<StatusInfo>,
  statusId: Ref<Status>
): string => {
  const statusDoc = statuses.find(s => s._id === statusId)
  return statusDoc?.name ?? "Unknown"
}

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

    if (params.createdBy !== undefined) {
      const creatorPerson = yield* findPersonByEmailOrName(client, params.createdBy)
      if (creatorPerson === undefined) return []
      // A person has one social identity per provider; Doc.createdBy holds one of them.
      const socialIdentities = yield* client.findAll<SocialIdentity>(
        contact.class.SocialIdentity,
        { attachedTo: creatorPerson._id }
      )
      if (socialIdentities.length === 0) return []
      query.createdBy = { $in: socialIdentities.map((si) => si._id) }
    }

    // Apply title search using $like operator
    if (params.titleSearch !== undefined && params.titleSearch.trim() !== "") {
      query.title = { $like: `%${escapeLikeWildcards(params.titleSearch)}%` }
    }

    if (params.titleRegex !== undefined && params.titleRegex.trim() !== "") {
      query.title = { $regex: params.titleRegex }
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

    // Filter by milestone (sprint): resolve by _id first, then by label — same as set_issue_milestone.
    if (params.milestone !== undefined) {
      const milestone = yield* findByNameOrId<HulyMilestone>(
        client,
        tracker.class.Milestone,
        { space: project._id, _id: toRef<HulyMilestone>(params.milestone) },
        { space: project._id, label: params.milestone }
      )
      if (milestone === undefined) return []
      query.milestone = milestone._id
    }

    if (params.hasAssignee === true) {
      query.assignee = { $ne: null }
    } else if (params.hasAssignee === false) {
      query.assignee = null
    }

    if (params.hasDueDate === true) {
      query.dueDate = { $ne: null }
    } else if (params.hasDueDate === false) {
      query.dueDate = null
    }

    if (params.hasComponent === true) {
      query.component = { $ne: null }
    } else if (params.hasComponent === false) {
      query.component = null
    }

    if (params.isTopLevel === true) {
      query.attachedToClass = tracker.class.Project
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

    const creatorIds = [
      ...new Set(issues.map((issue) => issue.createdBy).filter((id): id is PersonId => id !== undefined))
    ]
    const creatorNames = yield* buildSocialIdToPersonNameMap(client, creatorIds)

    // Ref → label for the milestone (sprint) column. One query per list; milestones per project are few.
    const milestones = yield* client.findAll<HulyMilestone>(
      tracker.class.Milestone,
      { space: project._id }
    )
    const milestoneLabels = new Map(milestones.map((m) => [m._id, m.label]))

    const rawSummaries = issues.map((issue) => {
      const statusName = resolveStatusName(statuses, issue.status)
      const assigneeName = issue.$lookup?.assignee?.name
      const directParent = issue.parents.length > 0
        ? issue.parents[issue.parents.length - 1]
        : undefined

      return {
        identifier: issue.identifier,
        title: issue.title,
        status: statusName,
        priority: priorityToString(issue.priority),
        assignee: assigneeName,
        createdBy: issue.createdBy !== undefined ? creatorNames.get(issue.createdBy) : undefined,
        parentIssue: directParent?.identifier,
        milestone: issue.milestone != null ? milestoneLabels.get(issue.milestone) : undefined,
        subIssues: issue.subIssues > 0 ? issue.subIssues : undefined,
        modifiedOn: issue.modifiedOn
      }
    })

    // Spread: Schema.decodeUnknown returns readonly array; return type requires mutable
    const validated = yield* Schema.decodeUnknown(Schema.Array(IssueSummarySchema))(rawSummaries).pipe(
      Effect.mapError((parseError) =>
        new HulyConnectionError({
          message: `listIssues response failed schema validation: ${parseError.message}`,
          cause: parseError
        })
      )
    )

    return [...validated]
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

    const person = issue.assignee !== null
      ? yield* client.findOne<Person>(contact.class.Person, { _id: issue.assignee })
      : undefined

    const creatorNames = issue.createdBy !== undefined
      ? yield* buildSocialIdToPersonNameMap(client, [issue.createdBy])
      : undefined
    const createdByName = issue.createdBy !== undefined ? creatorNames?.get(issue.createdBy) : undefined

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

    const milestoneDoc = issue.milestone != null
      ? yield* client.findOne<HulyMilestone>(tracker.class.Milestone, { _id: issue.milestone })
      : undefined

    return yield* parseIssue({
      identifier: issue.identifier,
      title: issue.title,
      description,
      status: statusName,
      priority: priorityToString(issue.priority),
      assignee: person?.name,
      assigneeRef: person
        ? { id: person._id, name: person.name }
        : undefined,
      createdBy: createdByName,
      project: params.project,
      parentIssue: directParent?.identifier,
      milestone: milestoneDoc?.label,
      subIssues: issue.subIssues > 0 ? issue.subIssues : undefined,
      modifiedOn: issue.modifiedOn,
      createdOn: issue.createdOn,
      dueDate: issue.dueDate ?? undefined,
      estimation: issue.estimation > 0 ? issue.estimation : undefined
    }).pipe(
      Effect.mapError((parseError) =>
        new HulyConnectionError({
          message: `getIssue response failed schema validation: ${parseError.message}`,
          cause: parseError
        })
      )
    )
  })
