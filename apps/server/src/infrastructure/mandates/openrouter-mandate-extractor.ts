import { OpenRouter } from '@openrouter/sdk';
import { OpenRouterError, RequestTimeoutError } from '@openrouter/sdk/models/errors';

import type {
  MandateAnswer,
  MandateContext,
  MandateDocument,
  MandateExtractor,
} from '../../application/ports/mandates.ts';
import { mandateAnswerJsonSchema } from '../../domain/mandate.ts';

/**
 * The answer is about 600 tokens, but the reasoning counts in this limit too. 32 000 (the user's choice,
 * 2026-10-11): at 16 000, about 7 % of the readings were cut; a run that reaches it costs about $0.016.
 */
const MAX_ANSWER_TOKENS = 32_000;
/** The PDF's own text helps with numbers, but a few pages are enough. */
const MAX_TEXT_CHARACTERS = 20_000;
const TIMEOUT_MS = 120_000;
/** The fallback model does not reason long: a minute is plenty for a 600-token answer. */
const FALLBACK_TIMEOUT_MS = 60_000;
/** Tokens per second (p50, the user's choice): at 75, a reading of 6 000 tokens ends in about 80 s. */
const MIN_THROUGHPUT = 75;

const INSTRUCTIONS = `Tu lis le mandat d'un concours de tir à l'arc de la FFTA (le document de l'organisateur). Tu reçois les pages en images, et leur texte quand le PDF en a un (le texte peut être mal ordonné : les images font foi).

Réponds uniquement avec le JSON demandé. Ne devine jamais : ce qui n'est pas écrit dans le mandat reste vide (liste vide ou null).

Un même mandat sert souvent à plusieurs concours FFTA (un samedi et un dimanche) : ne donne que les départs des jours de ce concours.

departures : chaque départ (séance de tir) du concours, dans l'ordre. Un concours sur deux jours a souvent "samedi après-midi, dimanche matin, dimanche après-midi".
- date : le jour du départ (AAAA-MM-JJ), parmi les jours du concours ; null si le mandat ne dit pas quel jour.
- label : le nom du départ tel que le mandat l'écrit, court ("Samedi après-midi", "Départ 2").
- registrationOpens : l'heure d'ouverture du greffe (HH:MM), sinon null.
- shootingStarts : l'heure du début des tirs (HH:MM), sinon null ; pas l'heure de l'échauffement ni de l'entraînement.

prices : les tarifs d'inscription par archer.
- amountEuros : le prix TOTAL pour ce nombre de départs ("1 tir 9 €, 2 tirs 16 €" donne deux tarifs : 1 départ 9, 2 départs 16). Quand le mandat donne un prix pour le premier départ et un autre pour chaque départ suivant ("Premier tir : 12 €, autre tir : 8 €"), donne le TOTAL pour 1, 2, 3… départs, jusqu'au nombre de départs du concours : 1 départ 12, 2 départs 20, 3 départs 28. Ne donne jamais deux prix différents pour le même nombre de départs et les mêmes catégories.
- departures : le nombre de départs que ce prix couvre (1 si le prix est par départ).
- categories : les catégories d'âge FFTA auxquelles ce prix s'applique, telles que le mandat les nomme : U11, U13, U15, U18, U21 (les jeunes), S1, S2, S3 (les adultes). "Jeunes" ou "-21 ans" donne U11, U13, U15, U18, U21 ; "-18 ans" donne U11, U13, U15, U18 ; "Adultes", "Seniors" ou "Scratch" donne S1, S2, S3 ; un prix pour tous les archers donne les huit. Les anciens noms : poussins U11, benjamins U13, minimes U15, cadets U18, juniors U21. Recopie chaque ligne de tarif du mandat telle qu'elle est, même si une catégorie apparaît dans deux lignes ("U11 + Promotion : 6 €, Jeunes : 8 €" donne un tarif U11 à 6 et un tarif U11 à U21 à 8) : le programme choisit lui-même le plus précis.
- Ignore les repas, buvettes, licences découverte, équipes et options : seulement l'inscription individuelle.

foamTargets : "yes" seulement si le mandat dit que les cibles ou les buttes sont en mousse ; "no" s'il dit qu'elles sont en paille ou dans une autre matière ; "not_mentioned" sinon (le plus souvent). Un blason "trispot" n'est pas une cible en mousse.

rhythms : tous les rythmes de tir que le mandat écrit, c'est-à-dire l'ordre de passage des archers sur une cible : "AB" (deux par deux), "ABC" (trois par trois) ou "AB/CD" (quatre archers par cible, en deux vagues : AB puis CD). On les trouve souvent écrits "rythme AB/CD", "tir en AB-CD", "ABC" ou "2 vagues". Donne-les tous, tels qu'écrits : "AB/CD ou ABC en fonction du nombre de tireurs" donne ["AB/CD", "ABC"]. Une liste vide si le mandat n'en dit rien.

evidence : pour departures, prices, foamTargets et rhythm (les rythmes), les mots exacts du mandat qui le disent (une courte citation), ou null.`;

/**
 * GLM 5.3 Flash through OpenRouter, the user's choice (2026-10-09): it reads images, cheaply. Its reasoning cannot be
 * turned off and sometimes runs past the timeout, and its providers sometimes answer with an error: the mandate is
 * then read by a model that does not reason (Gemini 3.1 Flash-Lite, close on document benchmarks, about 4× the
 * price; the user's choice, 2026-10-11 for timeouts, 2026-10-16 for errors).
 */
export class OpenRouterMandateExtractor implements MandateExtractor {
  readonly #client: OpenRouter;
  readonly #model: string;
  readonly #fallbackModel: string;

  constructor(apiKey: string, model: string, fallbackModel: string) {
    this.#client = new OpenRouter({ apiKey });
    this.#model = model;
    this.#fallbackModel = fallbackModel;
  }

  async extract(document: MandateDocument, context: MandateContext): Promise<MandateAnswer> {
    try {
      // Low (the user's choice, 2026-10-11; was medium, whose long reasonings hit the timeout). Not off: some GLM 5.3
      // Flash providers refuse it ("Reasoning is mandatory for this endpoint").
      return await this.#read(document, context, this.#model, 'low', TIMEOUT_MS);
    } catch (error) {
      // Before the headers, the SDK throws its RequestTimeoutError. Once they arrived, reading the body throws the bare
      // DOMException "The operation timed out." (the one seen in the runs of 2026-10-11). An HTTP error answer is an
      // OpenRouterError ("Provider returned error", 2026-10-16).
      const timedOut =
        error instanceof RequestTimeoutError || (error instanceof DOMException && error.name === 'TimeoutError');
      if (!timedOut && !(error instanceof OpenRouterError)) throw error;
      try {
        return await this.#read(document, context, this.#fallbackModel, 'minimal', FALLBACK_TIMEOUT_MS);
      } catch (fallbackError) {
        throw new Error(`${describe(error)}, puis ${this.#fallbackModel} : ${describe(fallbackError)}`, {
          cause: fallbackError,
        });
      }
    }
  }

  async #read(
    document: MandateDocument,
    context: MandateContext,
    model: string,
    effort: 'low' | 'minimal',
    timeoutMs: number,
  ): Promise<MandateAnswer> {
    const about = `Concours « ${context.title} » à ${context.town}, du ${context.startDate} au ${context.endDate}.`;
    const text = document.text
      ? `Texte du PDF :\n${document.text.slice(0, MAX_TEXT_CHARACTERS)}`
      : 'Le PDF n’a pas de texte (mandat scanné) : lis les images.';
    const result = await this.#client.chat.send(
      {
        chatRequest: {
          model,
          temperature: 0,
          maxTokens: MAX_ANSWER_TOKENS,
          reasoning: { effort },
          // Mandates hold the organizers' names and phones: only providers that keep nothing, and that honour the schema.
          // The cheapest provider among those fast enough (p50 ≥ 75 tokens/s); slower ones only as a fallback. OpenRouter
          // has no "price per speed" sort, this is its way to ask for both (the user's choice, 2026-10-11).
          provider: {
            dataCollection: 'deny',
            requireParameters: true,
            sort: 'price',
            preferredMinThroughput: MIN_THROUGHPUT,
          },
          responseFormat: {
            type: 'json_schema',
            jsonSchema: { name: 'mandat', strict: true, schema: mandateAnswerJsonSchema },
          },
          messages: [
            { role: 'system', content: INSTRUCTIONS },
            {
              role: 'user',
              content: [
                { type: 'text', text: `${about}\n\n${text}` },
                ...document.pageImages.map((image) => ({
                  type: 'image_url' as const,
                  imageUrl: { url: `data:image/jpeg;base64,${Buffer.from(image).toString('base64')}` },
                })),
              ],
            },
          ],
        },
      },
      {
        timeoutMs,
        // The SDK's default, except that a timeout is not sent again (it was, for up to an hour): it goes to the
        // fallback model instead. 5xx answers are still tried again.
        retries: {
          strategy: 'backoff',
          backoff: { initialInterval: 500, maxInterval: 60_000, exponent: 1.5, maxElapsedTime: 3_600_000 },
          retryConnectionErrors: false,
        },
      },
    );
    if (!('choices' in result)) throw new Error('réponse inattendue (flux)');
    const [choice] = result.choices;
    const content = choice?.message.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('réponse vide');
    const answer = answerJson(content);
    if (answer === undefined) {
      // Never the content itself: it quotes the mandate, which names the organizers.
      const cut = choice?.finishReason === 'length' ? ', coupée par la limite de longueur' : '';
      throw new Error(`la réponse n’est pas du JSON (${content.length} caractères${cut})`);
    }
    return { answer, model: result.model, costUsd: result.usage?.cost ?? null };
  }
}

/**
 * An error's message, with the HTTP code and the provider of an OpenRouter error answer ("Provider returned error"
 * alone does not tell why). Never the body itself: a provider's raw error may quote the request.
 */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (!(error instanceof OpenRouterError)) return error.message;
  let provider: unknown;
  try {
    provider = JSON.parse(error.body)?.error?.metadata?.provider_name;
  } catch {
    // Not JSON: the code is enough.
  }
  return `${error.message} (code HTTP ${error.statusCode}${typeof provider === 'string' ? `, ${provider}` : ''})`;
}

/**
 * The JSON in the LLM's answer. Some providers wrap it in a ```json fence or a sentence despite the schema: the object
 * between the first "{" and the last "}" is tried then. `undefined` when there is none.
 */
export function answerJson(content: string): unknown {
  for (const candidate of [content, content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next form.
    }
  }
  return undefined;
}
