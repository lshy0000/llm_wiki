import { useWikiStore } from "@/stores/wiki-store"
import { detectLanguage } from "./detect-language"
import { getLanguagePromptName } from "./language-metadata"

/**
 * Get the effective output language for LLM content generation.
 *
 * If user has explicitly set a non-English outputLanguage, use it.
 * English is treated as a weak default: when the source/input text is
 * clearly non-English, follow that language instead of forcing English.
 * Otherwise (auto), follow the source/input language. When there is no
 * reliable text to detect from, prefer Chinese over silently falling back
 * to English.
 */
export function getOutputLanguage(fallbackText: string = ""): string {
  const configured = useWikiStore.getState().outputLanguage
  const trimmed = fallbackText.trim()
  const detected = trimmed ? detectLanguage(trimmed) : ""
  if (configured && configured !== "auto") {
    if (configured === "English") {
      if (!detected || detected !== "English") {
        return detected || "Chinese"
      }
    }
    return configured
  }
  return detected || "Chinese"
}

/**
 * Build a strong language directive to inject into system prompts.
 */
export function buildLanguageDirective(fallbackText: string = ""): string {
  const configured = useWikiStore.getState().outputLanguage
  const lang = getOutputLanguage(fallbackText)
  const promptLang = getLanguagePromptName(lang)
  const languageSelectionRules =
    configured === "auto"
      ? [
          "The configured language is auto: follow the primary language of the source/input text.",
          "If there is no reliable source/input language, prefer Chinese.",
        ]
      : configured === "English" && lang !== "English"
        ? [
            "English is treated as a weak default here because the source/input is absent or clearly non-English.",
            `Use ${promptLang} instead of forcing English.`,
          ]
        : [`The configured output language is ${promptLang}; use it for generated explanatory text.`]
  return [
    `## ⚠️ MANDATORY OUTPUT LANGUAGE: ${promptLang}`,
    "",
    `Write explanatory prose, summaries, descriptions, wiki structure, and generated section text in **${promptLang}**.`,
    ...languageSelectionRules,
    "Preserve source terminology: keep entity names, product names, acronyms, named methods, domain terms, and quoted concepts exactly as they appear in the source when they are canonical names.",
    `If a preserved term is not in ${promptLang}, keep the original term and add a short ${promptLang} explanation or translation in parentheses when useful.`,
    "Do not transliterate, translate, normalize, or rename special terms just to satisfy the output language.",
    `Use ${promptLang} for surrounding explanation and section wording, while allowing preserved source terms to remain in their original language.`,
  ].join("\n")
}

/**
 * Short reminder version — for placing right before user's current message.
 */
export function buildLanguageReminder(fallbackText: string = ""): string {
  const lang = getOutputLanguage(fallbackText)
  return `REMINDER: Write explanatory text in ${getLanguagePromptName(lang)} and preserve source terms/canonical names exactly.`
}
