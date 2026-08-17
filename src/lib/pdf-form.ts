export type PdfFormValue = string | number | boolean | string[] | null

const MAX_FORM_INPUT_BYTES = 64 * 1024
const MAX_FORM_FIELDS = 128
const MAX_FORM_TEXT = 4_000
const MAX_FORM_OPTIONS = 32

function boundedText(value: string, fieldName: string) {
  if (value.length > MAX_FORM_TEXT) throw new Error(`表单字段“${fieldName}”的值过长，最多支持 ${MAX_FORM_TEXT} 个字符。`)
  return value
}

function normalizeValue(value: unknown, fieldName: string): PdfFormValue {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return boundedText(value, fieldName)
  if (typeof value === 'number' && Number.isFinite(value)) return boundedText(String(value), fieldName)
  if (Array.isArray(value) && value.length <= MAX_FORM_OPTIONS && value.every((item) => typeof item === 'string')) {
    return value.map((item) => boundedText(item, fieldName))
  }
  throw new Error(`表单字段“${fieldName}”的值必须是字符串、数字、布尔值或字符串数组。`)
}

/** Parse the deliberately small JSON contract used by the PDF form filler. */
export function parsePdfFormValues(raw: string): Record<string, PdfFormValue> {
  const source = raw.trim()
  if (!source) throw new Error('请输入表单字段 JSON。')
  if (new TextEncoder().encode(source).byteLength > MAX_FORM_INPUT_BYTES) {
    throw new Error(`表单字段 JSON 过大，最多支持 ${MAX_FORM_INPUT_BYTES / 1024} KB。`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('表单字段 JSON 格式无效，请检查引号、逗号和括号。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('表单字段 JSON 必须是“字段名: 值”的对象。')
  }
  const entries = Object.entries(parsed)
  if (entries.length === 0) throw new Error('表单字段 JSON 不能为空。')
  if (entries.length > MAX_FORM_FIELDS) throw new Error(`一次最多填写 ${MAX_FORM_FIELDS} 个字段。`)
  const result: Record<string, PdfFormValue> = {}
  for (const [rawName, value] of entries) {
    const name = rawName.trim()
    if (!name || name.length > 400) throw new Error('表单字段名不能为空，且最多支持 400 个字符。')
    result[name] = normalizeValue(value, name)
  }
  return result
}

function stringValues(value: PdfFormValue, fieldName: string) {
  if (value === null) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value
  throw new Error(`字段“${fieldName}”需要字符串或字符串数组。`)
}

function ensureAllowed(options: string[], selected: string[], fieldName: string) {
  const invalid = selected.filter((value) => !options.includes(value))
  if (invalid.length) throw new Error(`字段“${fieldName}”包含不存在的选项：${invalid.join('、')}`)
}

/** Fill supported AcroForm fields and return a new PDF byte array. */
export async function fillPdfForm(data: ArrayBuffer, rawValues: string) {
  const values = parsePdfFormValues(rawValues)
  const {
    PDFButton,
    PDFCheckBox,
    PDFDocument,
    PDFDropdown,
    PDFOptionList,
    PDFRadioGroup,
    PDFSignature,
    PDFTextField,
  } = await import('pdf-lib')
  const document = await PDFDocument.load(data)
  const form = document.getForm()
  const fields = form.getFields()
  const fieldMap = new Map(fields.map((field) => [field.getName(), field]))
  const unknown = Object.keys(values).filter((name) => !fieldMap.has(name))
  if (unknown.length) throw new Error(`PDF 中没有这些字段：${unknown.slice(0, 8).join('、')}${unknown.length > 8 ? '…' : ''}`)

  for (const [name, value] of Object.entries(values)) {
    const field = fieldMap.get(name)
    if (!field) continue
    if (field instanceof PDFTextField) {
      if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw new Error(`字段“${name}”需要文本值。`)
      field.setText(value === null ? undefined : String(value))
    } else if (field instanceof PDFCheckBox) {
      if (typeof value !== 'boolean') throw new Error(`复选框“${name}”需要 true 或 false。`)
      if (value) field.check()
      else field.uncheck()
    } else if (field instanceof PDFDropdown) {
      const selected = stringValues(value, name)
      ensureAllowed(field.getOptions(), selected, name)
      if (selected.length > 1 && !field.isMultiselect()) throw new Error(`下拉框“${name}”不支持多选。`)
      field.select(selected)
    } else if (field instanceof PDFOptionList) {
      const selected = stringValues(value, name)
      ensureAllowed(field.getOptions(), selected, name)
      if (selected.length > 1 && !field.isMultiselect()) throw new Error(`选项列表“${name}”不支持多选。`)
      field.select(selected)
    } else if (field instanceof PDFRadioGroup) {
      if (value === null) field.clear()
      else if (typeof value !== 'string') throw new Error(`单选框“${name}”需要字符串值。`)
      else {
        ensureAllowed(field.getOptions(), [value], name)
        field.select(value)
      }
    } else if (field instanceof PDFSignature || field instanceof PDFButton) {
      throw new Error(`字段“${name}”属于不支持填写的 ${field instanceof PDFSignature ? '签名' : '按钮'} 类型。`)
    } else {
      throw new Error(`字段“${name}”属于当前版本不支持的类型。`)
    }
  }

  form.updateFieldAppearances()
  return document.save()
}
