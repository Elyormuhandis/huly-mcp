import {
  createTestCaseParamsJsonSchema,
  createTestSuiteParamsJsonSchema,
  deleteTestCaseParamsJsonSchema,
  deleteTestSuiteParamsJsonSchema,
  getTestCaseParamsJsonSchema,
  getTestSuiteParamsJsonSchema,
  listTestCasesParamsJsonSchema,
  listTestProjectsParamsJsonSchema,
  listTestSuitesParamsJsonSchema,
  parseCreateTestCaseParams,
  parseCreateTestSuiteParams,
  parseDeleteTestCaseParams,
  parseDeleteTestSuiteParams,
  parseGetTestCaseParams,
  parseGetTestSuiteParams,
  parseListTestCasesParams,
  parseListTestProjectsParams,
  parseListTestSuitesParams,
  parseUpdateTestCaseParams,
  parseUpdateTestSuiteParams,
  updateTestCaseParamsJsonSchema,
  updateTestSuiteParamsJsonSchema
} from "../../domain/schemas/test-management-core.js"
import {
  createTestCase,
  createTestSuite,
  deleteTestCase,
  deleteTestSuite,
  getTestCase,
  getTestSuite,
  listTestCases,
  listTestProjects,
  listTestSuites,
  updateTestCase,
  updateTestSuite
} from "../../huly/operations/test-management-core.js"
import { createToolHandler, type RegisteredTool } from "./registry.js"

const CATEGORY = "test-management" as const

export const testManagementCoreTools: ReadonlyArray<RegisteredTool> = [
  {
    name: "list_test_projects",
    description:
      "List test management projects. Returns test projects sorted by name. These are separate from tracker projects.",
    category: CATEGORY,
    inputSchema: listTestProjectsParamsJsonSchema,
    handler: createToolHandler(
      "list_test_projects",
      parseListTestProjectsParams,
      listTestProjects
    )
  },
  {
    name: "list_test_suites",
    description:
      "List test suites in a test project. Accepts project ID or name. Optional parent filter for nested suites.",
    category: CATEGORY,
    inputSchema: listTestSuitesParamsJsonSchema,
    handler: createToolHandler(
      "list_test_suites",
      parseListTestSuitesParams,
      listTestSuites
    )
  },
  {
    name: "get_test_suite",
    description:
      "Get a single test suite by ID or name within a test project. Returns suite details and test case count.",
    category: CATEGORY,
    inputSchema: getTestSuiteParamsJsonSchema,
    handler: createToolHandler(
      "get_test_suite",
      parseGetTestSuiteParams,
      getTestSuite
    )
  },
  {
    name: "create_test_suite",
    description:
      "Create a test suite in a test project. Idempotent: returns existing suite if one with the same name exists (created=false). Optional parent for nesting.",
    category: CATEGORY,
    inputSchema: createTestSuiteParamsJsonSchema,
    handler: createToolHandler(
      "create_test_suite",
      parseCreateTestSuiteParams,
      createTestSuite
    )
  },
  {
    name: "update_test_suite",
    description: "Update a test suite. Accepts suite ID or name. Only provided fields are modified.",
    category: CATEGORY,
    inputSchema: updateTestSuiteParamsJsonSchema,
    handler: createToolHandler(
      "update_test_suite",
      parseUpdateTestSuiteParams,
      updateTestSuite
    )
  },
  {
    name: "delete_test_suite",
    description: "Permanently delete a test suite. Accepts suite ID or name. This action cannot be undone.",
    category: CATEGORY,
    inputSchema: deleteTestSuiteParamsJsonSchema,
    handler: createToolHandler(
      "delete_test_suite",
      parseDeleteTestSuiteParams,
      deleteTestSuite
    )
  },
  {
    name: "list_test_cases",
    description: "List test cases in a test project. Optional filters: suite (ID or name), assignee (name or email).",
    category: CATEGORY,
    inputSchema: listTestCasesParamsJsonSchema,
    handler: createToolHandler(
      "list_test_cases",
      parseListTestCasesParams,
      listTestCases
    )
  },
  {
    name: "get_test_case",
    description: "Get a single test case by ID or name within a test project.",
    category: CATEGORY,
    inputSchema: getTestCaseParamsJsonSchema,
    handler: createToolHandler(
      "get_test_case",
      parseGetTestCaseParams,
      getTestCase
    )
  },
  {
    name: "create_test_case",
    description:
      "Create a test case attached to a suite. Requires project and suite. Defaults: type=functional, priority=medium, status=draft.",
    category: CATEGORY,
    inputSchema: createTestCaseParamsJsonSchema,
    handler: createToolHandler(
      "create_test_case",
      parseCreateTestCaseParams,
      createTestCase
    )
  },
  {
    name: "update_test_case",
    description:
      "Update a test case. Accepts test case ID or name. Only provided fields are modified. Set assignee to null to unassign.",
    category: CATEGORY,
    inputSchema: updateTestCaseParamsJsonSchema,
    handler: createToolHandler(
      "update_test_case",
      parseUpdateTestCaseParams,
      updateTestCase
    )
  },
  {
    name: "delete_test_case",
    description: "Permanently delete a test case. Accepts test case ID or name. This action cannot be undone.",
    category: CATEGORY,
    inputSchema: deleteTestCaseParamsJsonSchema,
    handler: createToolHandler(
      "delete_test_case",
      parseDeleteTestCaseParams,
      deleteTestCase
    )
  }
]
