import {
  createWorkspaceParamsJsonSchema,
  CreateWorkspaceResultSchema,
  DeleteWorkspaceResultSchema,
  emptyParamsJsonSchema,
  getRegionsParamsJsonSchema,
  GetRegionsResultSchema,
  GetUserProfileResultSchema,
  listWorkspaceMembersParamsJsonSchema,
  ListWorkspaceMembersResultSchema,
  listWorkspacesParamsJsonSchema,
  ListWorkspacesResultSchema,
  parseCreateWorkspaceParams,
  parseGetRegionsParams,
  parseListWorkspaceMembersParams,
  parseListWorkspacesParams,
  parseUpdateGuestSettingsParams,
  parseUpdateMemberRoleParams,
  parseUpdateUserProfileParams,
  updateGuestSettingsParamsJsonSchema,
  UpdateGuestSettingsResultSchema,
  updateMemberRoleParamsJsonSchema,
  UpdateMemberRoleResultSchema,
  updateUserProfileParamsJsonSchema,
  UpdateUserProfileResultSchema,
  WorkspaceInfoSchema
} from "../../domain/schemas.js"
import {
  createWorkspace,
  deleteWorkspace,
  getRegions,
  getUserProfile,
  getWorkspaceInfo,
  listWorkspaceMembers,
  listWorkspaces,
  updateGuestSettings,
  updateMemberRole,
  updateUserProfile
} from "../../huly/operations/workspace.js"
import {
  createEncodedNoParamsWorkspaceToolHandler,
  createEncodedWorkspaceToolHandler,
  type RegisteredTool
} from "./registry.js"

const CATEGORY = "workspace" as const

export const workspaceTools: ReadonlyArray<RegisteredTool> = [
  {
    name: "list_workspace_members",
    description:
      "List members in the current Huly workspace with their roles. Returns members with account IDs and roles.",
    category: CATEGORY,
    inputSchema: listWorkspaceMembersParamsJsonSchema,
    handler: createEncodedWorkspaceToolHandler(
      "list_workspace_members",
      parseListWorkspaceMembersParams,
      listWorkspaceMembers,
      ListWorkspaceMembersResultSchema
    )
  },
  {
    name: "update_member_role",
    description:
      "Update a workspace member's role. Requires appropriate permissions. Valid roles: READONLYGUEST, DocGuest, GUEST, USER, MAINTAINER, OWNER, ADMIN.",
    category: CATEGORY,
    inputSchema: updateMemberRoleParamsJsonSchema,
    handler: createEncodedWorkspaceToolHandler(
      "update_member_role",
      parseUpdateMemberRoleParams,
      updateMemberRole,
      UpdateMemberRoleResultSchema
    )
  },
  {
    name: "get_workspace_info",
    description: "Get information about the current workspace including name, URL, region, and settings.",
    category: CATEGORY,
    inputSchema: emptyParamsJsonSchema,
    handler: createEncodedNoParamsWorkspaceToolHandler(
      "get_workspace_info",
      getWorkspaceInfo,
      WorkspaceInfoSchema
    )
  },
  {
    name: "list_workspaces",
    description:
      "List all workspaces accessible to the current user. Returns workspace summaries sorted by last visit.",
    category: CATEGORY,
    inputSchema: listWorkspacesParamsJsonSchema,
    handler: createEncodedWorkspaceToolHandler(
      "list_workspaces",
      parseListWorkspacesParams,
      listWorkspaces,
      ListWorkspacesResultSchema
    )
  },
  {
    name: "create_workspace",
    description: "Create a new Huly workspace. Returns the workspace UUID and URL. Optionally specify a region.",
    category: CATEGORY,
    inputSchema: createWorkspaceParamsJsonSchema,
    handler: createEncodedWorkspaceToolHandler(
      "create_workspace",
      parseCreateWorkspaceParams,
      createWorkspace,
      CreateWorkspaceResultSchema
    )
  },
  {
    name: "delete_workspace",
    description: "Permanently delete the current workspace. This action cannot be undone. Use with extreme caution.",
    category: CATEGORY,
    inputSchema: emptyParamsJsonSchema,
    handler: createEncodedNoParamsWorkspaceToolHandler(
      "delete_workspace",
      deleteWorkspace,
      DeleteWorkspaceResultSchema
    )
  },
  {
    name: "get_user_profile",
    description: "Get the current user's profile information including bio, location, and social links.",
    category: CATEGORY,
    inputSchema: emptyParamsJsonSchema,
    handler: createEncodedNoParamsWorkspaceToolHandler(
      "get_user_profile",
      getUserProfile,
      GetUserProfileResultSchema
    )
  },
  {
    name: "update_user_profile",
    description:
      "Update the current user's profile. Supports bio, city, country, website, social links, and public visibility.",
    category: CATEGORY,
    inputSchema: updateUserProfileParamsJsonSchema,
    handler: createEncodedWorkspaceToolHandler(
      "update_user_profile",
      parseUpdateUserProfileParams,
      updateUserProfile,
      UpdateUserProfileResultSchema
    )
  },
  {
    name: "update_guest_settings",
    description: "Update workspace guest settings. Control read-only guest access and guest sign-up permissions.",
    category: CATEGORY,
    inputSchema: updateGuestSettingsParamsJsonSchema,
    handler: createEncodedWorkspaceToolHandler(
      "update_guest_settings",
      parseUpdateGuestSettingsParams,
      updateGuestSettings,
      UpdateGuestSettingsResultSchema
    )
  },
  {
    name: "get_regions",
    description: "Get available regions for workspace creation. Returns region codes and display names.",
    category: CATEGORY,
    inputSchema: getRegionsParamsJsonSchema,
    handler: createEncodedWorkspaceToolHandler(
      "get_regions",
      parseGetRegionsParams,
      getRegions,
      GetRegionsResultSchema
    )
  }
]
