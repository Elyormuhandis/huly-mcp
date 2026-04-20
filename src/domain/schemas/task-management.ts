import { JSONSchema, Schema } from "effect"

import { LimitParam, NonEmptyString } from "./shared.js"

/**
 * Huly status category — maps to task:statusCategory:* refs.
 * Determines the visual group (color/icon) a status belongs to.
 */
export const StatusCategory = Schema.Literal(
  "UnStarted", // Backlog
  "ToDo", // To do
  "Active", // In progress, review, testing, etc.
  "Won", // Done
  "Lost" // Cancelled
).annotations({
  title: "StatusCategory",
  description: "Category the status belongs to. UnStarted=Backlog, ToDo=To do, Active=Started, Won=Done, Lost=Cancelled"
})
export type StatusCategory = Schema.Schema.Type<typeof StatusCategory>

export const StatusId = NonEmptyString.pipe(
  Schema.brand("StatusId")
).annotations({
  title: "StatusId",
  description: "Ref<IssueStatus>"
})
export type StatusId = Schema.Schema.Type<typeof StatusId>

export const TaskTypeId = NonEmptyString.pipe(
  Schema.brand("TaskTypeId")
).annotations({
  title: "TaskTypeId",
  description: "Ref<TaskType>"
})
export type TaskTypeId = Schema.Schema.Type<typeof TaskTypeId>

export const ProjectTypeId = NonEmptyString.pipe(
  Schema.brand("ProjectTypeId")
).annotations({
  title: "ProjectTypeId",
  description: "Ref<ProjectType>"
})
export type ProjectTypeId = Schema.Schema.Type<typeof ProjectTypeId>

// ---- List Project Types ----

export const ListProjectTypesParamsSchema = Schema.Struct({
  descriptor: Schema.optional(
    NonEmptyString.annotations({
      description: "Optional descriptor filter (e.g. \"tracker:descriptors:ProjectType\" for tracker projects only)"
    })
  ),
  limit: Schema.optional(
    LimitParam.annotations({ description: "Maximum number of project types (default: 50)" })
  )
}).annotations({
  title: "ListProjectTypesParams",
  description: "Parameters for listing project types (workspace-wide templates)"
})
export type ListProjectTypesParams = Schema.Schema.Type<typeof ListProjectTypesParamsSchema>

export interface ProjectTypeSummary {
  readonly id: ProjectTypeId
  readonly name: string
  readonly descriptor: string
  readonly taskTypeIds: ReadonlyArray<TaskTypeId>
  readonly statusCount: number
}

export interface ListProjectTypesResult {
  readonly projectTypes: ReadonlyArray<ProjectTypeSummary>
}

// ---- List Task Types ----

export const ListTaskTypesParamsSchema = Schema.Struct({
  projectType: Schema.optional(
    NonEmptyString.annotations({
      description: "Filter to task types belonging to this project type (id or name). If omitted, returns all."
    })
  ),
  limit: Schema.optional(
    LimitParam.annotations({ description: "Maximum number of task types (default: 50)" })
  )
}).annotations({
  title: "ListTaskTypesParams",
  description: "Parameters for listing task types (issue types)"
})
export type ListTaskTypesParams = Schema.Schema.Type<typeof ListTaskTypesParamsSchema>

export interface TaskTypeSummary {
  readonly id: TaskTypeId
  readonly name: string
  readonly projectTypeId: ProjectTypeId
  readonly statusCount: number
  readonly ofClass: string
}

export interface ListTaskTypesResult {
  readonly taskTypes: ReadonlyArray<TaskTypeSummary>
}

// ---- Create Status ----

export const CreateStatusParamsSchema = Schema.Struct({
  name: NonEmptyString.annotations({ description: "Status display name (e.g. \"In review\", \"QA testing\")" }),
  category: StatusCategory,
  projectType: Schema.optional(
    NonEmptyString.annotations({
      description:
        "Project type id or name to attach the status to. Defaults to \"tracker:ids:ClassingProjectType\" (Classic project)."
    })
  ),
  taskType: Schema.optional(
    NonEmptyString.annotations({
      description:
        "Task type id or name to attach the status to. If omitted, applies to all task types in the project type."
    })
  )
}).annotations({
  title: "CreateStatusParams",
  description:
    "Create a new issue status at the workspace level by appending to both the TaskType.statuses array and the ProjectType.statuses array"
})
export type CreateStatusParams = Schema.Schema.Type<typeof CreateStatusParamsSchema>

export interface CreateStatusResult {
  readonly id: StatusId
  readonly name: string
  readonly category: string
  readonly created: boolean
  readonly attachedTaskTypes: ReadonlyArray<TaskTypeId>
}

// ---- Create Task Type ----

export const CreateTaskTypeParamsSchema = Schema.Struct({
  name: NonEmptyString.annotations({ description: "Task type display name (e.g. \"Bug\", \"Story\")" }),
  projectType: Schema.optional(
    NonEmptyString.annotations({
      description: "Project type id or name to add the task type to. Defaults to \"tracker:ids:ClassingProjectType\"."
    })
  ),
  templateTaskType: Schema.optional(
    NonEmptyString.annotations({
      description:
        "Existing task type to copy config (statuses, ofClass, ...) from. Defaults to the first task type of the project type."
    })
  )
}).annotations({
  title: "CreateTaskTypeParams",
  description: "Create a new task type (issue type) by copying an existing template and adding it to the project type"
})
export type CreateTaskTypeParams = Schema.Schema.Type<typeof CreateTaskTypeParamsSchema>

export interface CreateTaskTypeResult {
  readonly id: TaskTypeId
  readonly name: string
  readonly projectTypeId: ProjectTypeId
  readonly statusCount: number
  readonly created: boolean
}

// ---- JSON schemas ----

export const listProjectTypesParamsJsonSchema = JSONSchema.make(ListProjectTypesParamsSchema)
export const listTaskTypesParamsJsonSchema = JSONSchema.make(ListTaskTypesParamsSchema)
export const createStatusParamsJsonSchema = JSONSchema.make(CreateStatusParamsSchema)
export const createTaskTypeParamsJsonSchema = JSONSchema.make(CreateTaskTypeParamsSchema)

export const parseListProjectTypesParams = Schema.decodeUnknown(ListProjectTypesParamsSchema)
export const parseListTaskTypesParams = Schema.decodeUnknown(ListTaskTypesParamsSchema)
export const parseCreateStatusParams = Schema.decodeUnknown(CreateStatusParamsSchema)
export const parseCreateTaskTypeParams = Schema.decodeUnknown(CreateTaskTypeParamsSchema)
