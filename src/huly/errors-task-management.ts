/**
 * Errors for Task/Project type management (statuses, task types, project types).
 *
 * @module
 */
import { Schema } from "effect"

/**
 * Project type not found in the workspace.
 */
export class ProjectTypeNotFoundError extends Schema.TaggedError<ProjectTypeNotFoundError>()(
  "ProjectTypeNotFoundError",
  {
    identifier: Schema.String
  }
) {
  override get message(): string {
    return `Project type '${this.identifier}' not found`
  }
}

/**
 * Task type not found in the workspace.
 */
export class TaskTypeNotFoundError extends Schema.TaggedError<TaskTypeNotFoundError>()(
  "TaskTypeNotFoundError",
  {
    identifier: Schema.String
  }
) {
  override get message(): string {
    return `Task type '${this.identifier}' not found`
  }
}
