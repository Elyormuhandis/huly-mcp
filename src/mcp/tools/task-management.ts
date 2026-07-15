import {
  createStatusParamsJsonSchema,
  createTaskTypeParamsJsonSchema,
  listProjectTypesParamsJsonSchema,
  listTaskTypesParamsJsonSchema,
  parseCreateStatusParams,
  parseCreateTaskTypeParams,
  parseListProjectTypesParams,
  parseListTaskTypesParams
} from "../../domain/schemas/task-management.js"
import { createStatus, createTaskType, listProjectTypes, listTaskTypes } from "../../huly/operations/task-management.js"
import { createToolHandler, type RegisteredTool } from "./registry.js"

const CATEGORY = "task-management" as const

export const taskManagementTools: ReadonlyArray<RegisteredTool> = [
  {
    name: "list_project_types",
    description:
      "List project types (workspace-level templates like 'Classic project'). A ProjectType defines the task types and statuses available to projects that inherit from it.",
    category: CATEGORY,
    inputSchema: listProjectTypesParamsJsonSchema,
    handler: createToolHandler(
      "list_project_types",
      parseListProjectTypesParams,
      listProjectTypes
    )
  },
  {
    name: "list_task_types",
    description:
      "List task types (issue types) in the workspace. Task types are children of a ProjectType and define a kind of issue (e.g., Bug, Story). Optionally filter by project type.",
    category: CATEGORY,
    inputSchema: listTaskTypesParamsJsonSchema,
    handler: createToolHandler(
      "list_task_types",
      parseListTaskTypesParams,
      listTaskTypes
    )
  },
  {
    name: "create_status",
    description:
      "Create an issue status, or attach an existing one to task types. Appends it to TaskType.statuses and ProjectType.statuses so it shows up in all projects using that type. Defaults to the tracker's Classic project type if not specified. Idempotent by name: if the project type already has a status with that name, it is reused and merely attached to the target task type(s) (created=false) rather than duplicated. That is how you give a task type a status it lacks (e.g. add \"In review\" to Bug) — statuses are shared across task types and only membership differs, and setting a status a task type does not have silently dumps the issue to Backlog. Pass taskType to target one type; omit it to apply to all.",
    category: CATEGORY,
    inputSchema: createStatusParamsJsonSchema,
    handler: createToolHandler(
      "create_status",
      parseCreateStatusParams,
      createStatus
    )
  },
  {
    name: "create_task_type",
    description:
      "Create a new task type (issue type) by copying the configuration (statuses, ofClass, statusCategories) of an existing task type as template. Appends the new task type to the ProjectType.tasks array. Defaults to the tracker's Classic project type. Idempotent: returns existing task type if name matches.",
    category: CATEGORY,
    inputSchema: createTaskTypeParamsJsonSchema,
    handler: createToolHandler(
      "create_task_type",
      parseCreateTaskTypeParams,
      createTaskType
    )
  }
]
