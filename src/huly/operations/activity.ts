import type {
  ActivityMessage as HulyActivityMessage,
  DocUpdateMessage as HulyDocUpdateMessage,
  Reaction as HulyReaction,
  SavedMessage as HulySavedMessage,
  UserMentionInfo
} from "@hcengineering/activity"
import type { ChatMessage as HulyChatMessage } from "@hcengineering/chunter"
import type { AttachedData, Class, Doc, Ref } from "@hcengineering/core"
import { generateId, SortingOrder } from "@hcengineering/core"
import { Effect } from "effect"

import type {
  ActivityMessage,
  AddReactionParams,
  AddReactionResult,
  ListActivityParams,
  ListMentionsParams,
  ListReactionsParams,
  ListSavedMessagesParams,
  Mention,
  Reaction,
  RemoveReactionParams,
  RemoveReactionResult,
  SavedMessage,
  SaveMessageParams,
  SaveMessageResult,
  UnsaveMessageParams,
  UnsaveMessageResult
} from "../../domain/schemas/activity.js"
import { ActivityMessageId, EmojiCode, NonEmptyString, ObjectClassName } from "../../domain/schemas/shared.js"
import { HulyClient, type HulyClientError } from "../client.js"
import { ActivityMessageNotFoundError, ReactionNotFoundError, SavedMessageNotFoundError } from "../errors.js"
import { buildSocialIdToPersonNameMap } from "./channels.js"
import { optionalMarkupToMarkdown } from "./markup.js"
import { clampLimit, findOneOrFail, toRef } from "./shared.js"

import { activity, chunter, core } from "../huly-plugins.js"

type ListActivityError = HulyClientError

type AddReactionError = HulyClientError | ActivityMessageNotFoundError

type RemoveReactionError = HulyClientError | ReactionNotFoundError

type ListReactionsError = HulyClientError

type SaveMessageError = HulyClientError | ActivityMessageNotFoundError

type UnsaveMessageError = HulyClientError | SavedMessageNotFoundError

type ListSavedMessagesError = HulyClientError

type ListMentionsError = HulyClientError

/**
 * `findAll(ActivityMessage)` returns every subclass in one list, so each row has to be narrowed
 * before its text is readable. Predicates rather than casts — the repo bans `as`.
 */
const isChatMessage = (msg: HulyActivityMessage): msg is HulyChatMessage => msg._class === chunter.class.ChatMessage

const isDocUpdateMessage = (msg: HulyActivityMessage): msg is HulyDocUpdateMessage =>
  msg._class === activity.class.DocUpdateMessage

// SDK: Data<Reaction> requires createBy (PersonId, branded string) but server populates from auth context.
// PersonId = string & { __personId: true }; no SDK factory exists. Empty string is overwritten server-side.
// eslint-disable-next-line no-restricted-syntax -- see above
const serverPopulatedCreateBy: HulyReaction["createBy"] = "" as HulyReaction["createBy"]

/**
 * List activity messages for an object.
 * Results sorted by modifiedOn descending (newest first).
 *
 * `activity.class.ActivityMessage` is the BASE class and carries no text of its own, so the
 * subclass has to be read to get anything readable out of a row: a human comment is a
 * `chunter.class.ChatMessage` (its markup lives in `message`), while a system event is a
 * `DocUpdateMessage` (`action` = created/updated/removed). Mapping only the base fields returned
 * rows that were pure metadata — which made document comments unreadable through this tool, since
 * `list_comments` only covers issues.
 */
export const listActivity = (
  params: ListActivityParams
): Effect.Effect<Array<ActivityMessage>, ListActivityError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const limit = clampLimit(params.limit)

    const messages = yield* client.findAll<HulyActivityMessage>(
      activity.class.ActivityMessage,
      {
        attachedTo: toRef<Doc>(params.objectId),
        attachedToClass: toRef<Class<Doc>>(params.objectClass)
      },
      {
        limit,
        sort: {
          modifiedOn: SortingOrder.Descending
        }
      }
    )

    // modifiedBy is an opaque social id; a caller reading a discussion needs the name.
    const authorNames = yield* buildSocialIdToPersonNameMap(
      client,
      [...new Set(messages.map((msg) => msg.modifiedBy))]
    )

    const result: Array<ActivityMessage> = messages.map((msg) => ({
      id: ActivityMessageId.make(msg._id),
      objectId: msg.attachedTo,
      objectClass: ObjectClassName.make(msg.attachedToClass),
      messageClass: ObjectClassName.make(msg._class),
      message: isChatMessage(msg) ? optionalMarkupToMarkdown(msg.message, undefined) : undefined,
      action: isDocUpdateMessage(msg) ? msg.action : undefined,
      author: authorNames.get(msg.modifiedBy),
      modifiedBy: msg.modifiedBy,
      modifiedOn: msg.modifiedOn,
      isPinned: msg.isPinned,
      replies: msg.replies,
      reactions: msg.reactions,
      editedOn: msg.editedOn
    }))

    return result
  })

/**
 * Add a reaction to an activity message.
 */
export const addReaction = (
  params: AddReactionParams
): Effect.Effect<AddReactionResult, AddReactionError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const message = yield* findOneOrFail(
      client,
      activity.class.ActivityMessage,
      { _id: toRef<HulyActivityMessage>(params.messageId) },
      () => new ActivityMessageNotFoundError({ messageId: params.messageId })
    )

    const reactionId: Ref<HulyReaction> = generateId()

    const reactionData: AttachedData<HulyReaction> = {
      emoji: params.emoji,
      createBy: serverPopulatedCreateBy
    }

    yield* client.addCollection(
      activity.class.Reaction,
      message.space,
      message._id,
      activity.class.ActivityMessage,
      "reactions",
      reactionData,
      reactionId
    )

    return {
      reactionId: NonEmptyString.make(reactionId),
      messageId: ActivityMessageId.make(params.messageId)
    }
  })

/**
 * Remove a reaction from an activity message.
 */
export const removeReaction = (
  params: RemoveReactionParams
): Effect.Effect<RemoveReactionResult, RemoveReactionError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const reaction = yield* findOneOrFail(
      client,
      activity.class.Reaction,
      {
        attachedTo: toRef<HulyActivityMessage>(params.messageId),
        emoji: params.emoji
      },
      () =>
        new ReactionNotFoundError({
          messageId: params.messageId,
          emoji: params.emoji
        })
    )

    yield* client.removeDoc(
      activity.class.Reaction,
      reaction.space,
      reaction._id
    )

    return {
      messageId: ActivityMessageId.make(params.messageId),
      removed: true
    }
  })

/**
 * List reactions on an activity message.
 */
export const listReactions = (
  params: ListReactionsParams
): Effect.Effect<Array<Reaction>, ListReactionsError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const limit = clampLimit(params.limit)

    const reactions = yield* client.findAll<HulyReaction>(
      activity.class.Reaction,
      {
        attachedTo: toRef<HulyActivityMessage>(params.messageId)
      },
      { limit }
    )

    const result: Array<Reaction> = reactions.map((r) => ({
      id: r._id,
      messageId: ActivityMessageId.make(r.attachedTo),
      emoji: EmojiCode.make(r.emoji),
      createdBy: r.createBy
    }))

    return result
  })

/**
 * Save/bookmark an activity message.
 */
export const saveMessage = (
  params: SaveMessageParams
): Effect.Effect<SaveMessageResult, SaveMessageError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const message = yield* findOneOrFail(
      client,
      activity.class.ActivityMessage,
      { _id: toRef<HulyActivityMessage>(params.messageId) },
      () => new ActivityMessageNotFoundError({ messageId: params.messageId })
    )

    const savedId: Ref<HulySavedMessage> = generateId()

    yield* client.createDoc(
      activity.class.SavedMessage,
      core.space.Workspace,
      {
        attachedTo: message._id
      },
      savedId
    )

    return {
      savedId: NonEmptyString.make(savedId),
      messageId: ActivityMessageId.make(params.messageId)
    }
  })

/**
 * Remove a message from saved/bookmarks.
 */
export const unsaveMessage = (
  params: UnsaveMessageParams
): Effect.Effect<UnsaveMessageResult, UnsaveMessageError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const saved = yield* findOneOrFail(
      client,
      activity.class.SavedMessage,
      {
        attachedTo: toRef<HulyActivityMessage>(params.messageId)
      },
      () => new SavedMessageNotFoundError({ messageId: params.messageId })
    )

    yield* client.removeDoc(
      activity.class.SavedMessage,
      saved.space,
      saved._id
    )

    return {
      messageId: ActivityMessageId.make(params.messageId),
      removed: true
    }
  })

/**
 * List saved/bookmarked messages for the current user.
 */
export const listSavedMessages = (
  params: ListSavedMessagesParams
): Effect.Effect<Array<SavedMessage>, ListSavedMessagesError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const limit = clampLimit(params.limit)

    const saved = yield* client.findAll<HulySavedMessage>(
      activity.class.SavedMessage,
      {},
      { limit }
    )

    const result: Array<SavedMessage> = saved.map((s) => ({
      id: s._id,
      messageId: ActivityMessageId.make(s.attachedTo)
    }))

    return result
  })

/**
 * List mentions of the current user.
 */
export const listMentions = (
  params: ListMentionsParams
): Effect.Effect<Array<Mention>, ListMentionsError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const limit = clampLimit(params.limit)

    const mentions = yield* client.findAll<UserMentionInfo>(
      activity.class.UserMentionInfo,
      {},
      {
        limit,
        sort: {
          modifiedOn: SortingOrder.Descending
        }
      }
    )

    const result: Array<Mention> = mentions.map((m) => ({
      id: m._id,
      messageId: ActivityMessageId.make(m.attachedTo),
      userId: m.user,
      content: m.content
    }))

    return result
  })
