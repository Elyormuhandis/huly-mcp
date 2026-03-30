/* eslint-disable no-restricted-syntax -- SDK boundary: Huly's Doc/AnyAttribute types don't expose dynamic custom field data, class label, or kind. All casts bridge the gap between Huly's generic Doc type and the runtime shape of Attribute/Class documents. */
import type { AnyAttribute, Class, Doc, Ref } from "@hcengineering/core"
import { ClassifierKind, SortingOrder } from "@hcengineering/core"
import { Effect } from "effect"

import type {
  CustomFieldInfo,
  CustomFieldValue,
  GetCustomFieldValuesParams,
  ListCustomFieldsParams,
  SetCustomFieldParams,
  SetCustomFieldResult
} from "../../domain/schemas/custom-fields.js"
import { HulyClient, type HulyClientError } from "../client.js"
import { CustomFieldNotFoundError, CustomFieldObjectNotFoundError } from "../errors-custom-fields.js"
import { core } from "../huly-plugins.js"
import { clampLimit, toRef } from "./shared.js"

type ListCustomFieldsError = HulyClientError
type GetCustomFieldValuesError = HulyClientError | CustomFieldObjectNotFoundError
type SetCustomFieldError = HulyClientError | CustomFieldNotFoundError | CustomFieldObjectNotFoundError

const DEFAULT_LIMIT = 200

const extractLabel = (label: unknown): string => {
  if (typeof label === "string") {
    const parts = label.split(":")
    return parts.length > 0 ? parts[parts.length - 1] : label
  }
  return String(label ?? "")
}

const describeType = (type: Record<string, unknown>): { typeName: string; typeDetails: Record<string, unknown> } => {
  const _class = String(type._class ?? "")
  if (_class.includes("TypeString")) return { typeName: "string", typeDetails: {} }
  if (_class.includes("TypeNumber")) return { typeName: "number", typeDetails: {} }
  if (_class.includes("TypeBoolean")) return { typeName: "boolean", typeDetails: {} }
  if (_class.includes("EnumOf")) return { typeName: "enum", typeDetails: { enumRef: type.of } }
  if (_class.includes("ArrOf")) return { typeName: "array", typeDetails: { of: type.of } }
  if (_class.includes("RefTo")) return { typeName: "ref", typeDetails: { to: type.to } }
  if (_class.includes("TypeDate")) return { typeName: "date", typeDetails: {} }
  if (_class.includes("TypeMarkup")) return { typeName: "markup", typeDetails: {} }
  return { typeName: _class, typeDetails: type }
}

interface ClassInfo {
  readonly label: string
  readonly kind: number
}

const classRef = core.class.Class as Ref<Class<Doc>>

const resolveClassInfo = (
  client: HulyClient["Type"],
  classId: string
): Effect.Effect<ClassInfo, HulyClientError> =>
  Effect.gen(function*() {
    const cls = yield* client.findOne<Doc>(
      classRef,
      { _id: toRef<Doc>(classId) }
    )
    if (cls !== undefined) {
      const record = cls as unknown as Record<string, unknown>
      return { label: extractLabel(record.label), kind: record.kind as number }
    }
    return { label: classId, kind: ClassifierKind.CLASS }
  })

const batchResolveClassLabels = (
  client: HulyClient["Type"],
  classIds: ReadonlyArray<string>
): Effect.Effect<Map<string, string>, HulyClientError> =>
  Effect.gen(function*() {
    if (classIds.length === 0) return new Map()

    const classes = yield* client.findAll<Doc>(
      classRef,
      { _id: { $in: classIds.map(toRef<Doc>) } }
    )

    const result = new Map<string, string>()
    for (const cls of classes) {
      const record = cls as unknown as Record<string, unknown>
      result.set(cls._id, extractLabel(record.label))
    }
    // Fill in missing entries with the raw ID
    for (const id of classIds) {
      if (!result.has(id)) {
        result.set(id, id)
      }
    }
    return result
  })

export const listCustomFields = (
  params: ListCustomFieldsParams
): Effect.Effect<Array<CustomFieldInfo>, ListCustomFieldsError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const limit = clampLimit(params.limit ?? DEFAULT_LIMIT)

    const query: Record<string, unknown> = { isCustom: true }
    if (params.targetClass !== undefined) {
      query.attributeOf = params.targetClass
    }

    const customAttrs = yield* client.findAll<AnyAttribute>(
      core.class.Attribute,
      query,
      { limit, sort: { modifiedOn: SortingOrder.Descending } }
    )

    const uniqueOwnerIds = [...new Set(customAttrs.map(a => a.attributeOf as string))]
    const ownerLabels = yield* batchResolveClassLabels(client, uniqueOwnerIds)

    return customAttrs.map(attr => {
      const ownerId = attr.attributeOf as string
      const typeRecord = attr.type as unknown as Record<string, unknown>
      const { typeDetails, typeName } = describeType(typeRecord)

      return {
        id: attr._id,
        name: attr.name,
        label: extractLabel(attr.label),
        ownerClassId: ownerId,
        ownerLabel: ownerLabels.get(ownerId) ?? ownerId,
        type: typeName,
        typeDetails
      }
    })
  })

export const getCustomFieldValues = (
  params: GetCustomFieldValuesParams
): Effect.Effect<Array<CustomFieldValue>, GetCustomFieldValuesError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const objectClassRef = toRef<Class<Doc>>(params.objectClass)
    const objectRef = toRef<Doc>(params.objectId)

    const [doc, customAttrs] = yield* Effect.all([
      client.findOne<Doc>(objectClassRef, { _id: objectRef }),
      client.findAll<AnyAttribute>(core.class.Attribute, { isCustom: true })
    ])

    if (doc === undefined) {
      return yield* new CustomFieldObjectNotFoundError({
        objectId: params.objectId,
        objectClass: params.objectClass
      })
    }

    const docRecord = doc as unknown as Record<string, unknown>
    const docKeys = new Set(Object.keys(docRecord))

    return customAttrs
      .filter(attr => docKeys.has(attr.name))
      .map(attr => {
        const typeRecord = attr.type as unknown as Record<string, unknown>
        const { typeName } = describeType(typeRecord)
        return {
          fieldId: attr._id,
          label: extractLabel(attr.label),
          value: docRecord[attr.name],
          type: typeName
        }
      })
  })

const parseValueForType = (value: string, typeName: string): unknown => {
  switch (typeName) {
    case "number": {
      const num = Number(value)
      if (Number.isNaN(num)) return value
      return num
    }
    case "boolean":
      return value.toLowerCase() === "true"
    default:
      return value
  }
}

export const setCustomField = (
  params: SetCustomFieldParams
): Effect.Effect<SetCustomFieldResult, SetCustomFieldError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const objectClassRef = toRef<Class<Doc>>(params.objectClass)
    const objectRef = toRef<Doc>(params.objectId)

    const [attr, doc] = yield* Effect.all([
      client.findOne<AnyAttribute>(
        core.class.Attribute,
        { _id: toRef<AnyAttribute>(params.fieldId), isCustom: true }
      ),
      client.findOne<Doc>(objectClassRef, { _id: objectRef })
    ])

    if (attr === undefined) {
      return yield* new CustomFieldNotFoundError({ identifier: params.fieldId })
    }

    if (doc === undefined) {
      return yield* new CustomFieldObjectNotFoundError({
        objectId: params.objectId,
        objectClass: params.objectClass
      })
    }

    const typeRecord = attr.type as unknown as Record<string, unknown>
    const { typeName } = describeType(typeRecord)
    const parsedValue = parseValueForType(params.value, typeName)

    const ownerClassId = attr.attributeOf as string
    const ownerInfo = yield* resolveClassInfo(client, ownerClassId)

    if (ownerInfo.kind === ClassifierKind.MIXIN) {
      yield* client.updateMixin(
        objectRef,
        objectClassRef,
        doc.space,
        toRef<Doc>(ownerClassId) as Ref<Class<Doc>>,
        { [attr.name]: parsedValue }
      )
    } else {
      yield* client.updateDoc(
        toRef<Class<Doc>>(ownerClassId),
        doc.space,
        objectRef,
        { [attr.name]: parsedValue }
      )
    }

    return {
      objectId: params.objectId,
      fieldId: attr._id,
      label: extractLabel(attr.label),
      value: parsedValue,
      updated: true
    }
  })
