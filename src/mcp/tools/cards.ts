import {
  createCardParamsJsonSchema,
  deleteCardParamsJsonSchema,
  getCardParamsJsonSchema,
  listCardSpacesParamsJsonSchema,
  listCardsParamsJsonSchema,
  listMasterTagsParamsJsonSchema,
  parseCreateCardParams,
  parseDeleteCardParams,
  parseGetCardParams,
  parseListCardSpacesParams,
  parseListCardsParams,
  parseListMasterTagsParams,
  parseUpdateCardParams,
  updateCardParamsJsonSchema
} from "../../domain/schemas.js"
import {
  createCard,
  deleteCard,
  getCard,
  listCards,
  listCardSpaces,
  listMasterTags,
  updateCard
} from "../../huly/operations/cards.js"
import { createToolHandler, type RegisteredTool } from "./registry.js"

const CATEGORY = "cards" as const

export const cardTools: ReadonlyArray<RegisteredTool> = [
  {
    name: "list_card_spaces",
    description: "List all Huly card spaces. Returns card spaces sorted by name. Card spaces are containers for cards.",
    category: CATEGORY,
    inputSchema: listCardSpacesParamsJsonSchema,
    handler: createToolHandler(
      "list_card_spaces",
      parseListCardSpacesParams,
      listCardSpaces
    )
  },
  {
    name: "list_master_tags",
    description:
      "List master tags (card types) available in a Huly card space. Master tags define the type/schema of cards that can be created in a space.",
    category: CATEGORY,
    inputSchema: listMasterTagsParamsJsonSchema,
    handler: createToolHandler(
      "list_master_tags",
      parseListMasterTagsParams,
      listMasterTags
    )
  },
  {
    name: "list_cards",
    description:
      "List cards in a Huly card space. Returns cards sorted by modification date (newest first). Supports filtering by type (master tag), title substring, and content search.",
    category: CATEGORY,
    inputSchema: listCardsParamsJsonSchema,
    handler: createToolHandler(
      "list_cards",
      parseListCardsParams,
      listCards
    )
  },
  {
    name: "get_card",
    description:
      "Retrieve full details for a Huly card including markdown content. Use this to view card content and metadata.",
    category: CATEGORY,
    inputSchema: getCardParamsJsonSchema,
    handler: createToolHandler(
      "get_card",
      parseGetCardParams,
      getCard
    )
  },
  {
    name: "create_card",
    description:
      "Create a new card in a Huly card space. Requires a master tag (card type). Content supports markdown formatting. Returns the created card id.",
    category: CATEGORY,
    inputSchema: createCardParamsJsonSchema,
    handler: createToolHandler(
      "create_card",
      parseCreateCardParams,
      createCard
    )
  },
  {
    name: "update_card",
    description:
      "Update fields on an existing Huly card. Only provided fields are modified. Content updates support markdown.",
    category: CATEGORY,
    inputSchema: updateCardParamsJsonSchema,
    handler: createToolHandler(
      "update_card",
      parseUpdateCardParams,
      updateCard
    )
  },
  {
    name: "delete_card",
    description: "Permanently delete a Huly card. This action cannot be undone.",
    category: CATEGORY,
    inputSchema: deleteCardParamsJsonSchema,
    handler: createToolHandler(
      "delete_card",
      parseDeleteCardParams,
      deleteCard
    )
  }
]
