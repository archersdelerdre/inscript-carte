import { OpenRouter } from '@openrouter/sdk';

import type {
  MandateAnswer,
  MandateContext,
  MandateDocument,
  MandateExtractor,
} from '../../application/ports/mandates.ts';
import { mandateAnswerJsonSchema } from '../../domain/mandate.ts';

/**
 * The answer is about 600 tokens, but the reasoning counts in this limit too: enough room so a long thought never
 * cuts the JSON. A run that reaches it is a model gone astray (about $0.008 at most).
 */
const MAX_ANSWER_TOKENS = 16_000;
/** The PDF's own text helps with numbers, but a few pages are enough. */
const MAX_TEXT_CHARACTERS = 20_000;
const TIMEOUT_MS = 120_000;

const INSTRUCTIONS = `Tu lis le mandat d'un concours de tir à l'arc de la FFTA (le document de l'organisateur). Tu reçois les pages en images, et leur texte quand le PDF en a un (le texte peut être mal ordonné : les images font foi).

Réponds uniquement avec le JSON demandé. Ne devine jamais : ce qui n'est pas écrit dans le mandat reste vide (liste vide ou null).

Un même mandat sert souvent à plusieurs concours FFTA (un samedi et un dimanche) : ne donne que les départs des jours de ce concours.

departures : chaque départ (séance de tir) du concours, dans l'ordre. Un concours sur deux jours a souvent "samedi après-midi, dimanche matin, dimanche après-midi".
- date : le jour du départ (AAAA-MM-JJ), parmi les jours du concours ; null si le mandat ne dit pas quel jour.
- label : le nom du départ tel que le mandat l'écrit, court ("Samedi après-midi", "Départ 2").
- registrationOpens : l'heure d'ouverture du greffe (HH:MM), sinon null.
- shootingStarts : l'heure du début des tirs (HH:MM), sinon null ; pas l'heure de l'échauffement ni de l'entraînement.

prices : les tarifs d'inscription par archer.
- amountEuros : le prix TOTAL pour ce nombre de départs ("1 tir 9 €, 2 tirs 16 €" donne deux tarifs : 1 départ 9, 2 départs 16).
- departures : le nombre de départs que ce prix couvre (1 si le prix est par départ).
- audience : "youth" pour les jeunes (jeunes, poussins, benjamins, minimes, cadets, juniors, -18 ans…), "adult" pour les adultes (adultes, seniors, scratch), "all" si le prix est le même pour tous.
- Ignore les repas, buvettes, licences découverte, équipes et options : seulement l'inscription individuelle.

foamTargets : "yes" seulement si le mandat dit que les cibles ou les buttes sont en mousse ; "no" s'il dit qu'elles sont en paille ou dans une autre matière ; "not_mentioned" sinon (le plus souvent). Un blason "trispot" n'est pas une cible en mousse.

evidence : pour departures, prices et foamTargets, les mots exacts du mandat qui le disent (une courte citation), ou null.`;

/** GLM 5.3 Flash through OpenRouter, the user's choice (2026-10-09): it reads images, cheaply. */
export class OpenRouterMandateExtractor implements MandateExtractor {
  readonly #client: OpenRouter;
  readonly #model: string;

  constructor(apiKey: string, model: string) {
    this.#client = new OpenRouter({ apiKey });
    this.#model = model;
  }

  async extract(document: MandateDocument, context: MandateContext): Promise<MandateAnswer> {
    const about = `Concours « ${context.title} » à ${context.town}, du ${context.startDate} au ${context.endDate}.`;
    const text = document.text
      ? `Texte du PDF :\n${document.text.slice(0, MAX_TEXT_CHARACTERS)}`
      : 'Le PDF n’a pas de texte (mandat scanné) : lis les images.';
    const result = await this.#client.chat.send(
      {
        chatRequest: {
          model: this.#model,
          temperature: 0,
          maxTokens: MAX_ANSWER_TOKENS,
          // Medium, the user's choice (2026-10-09). Not off: some GLM 5.3 Flash providers refuse it ("Reasoning is
          // mandatory for this endpoint").
          reasoning: { effort: 'medium' },
          // Mandates hold the organizers' names and phones: only providers that keep nothing, and that honour the schema.
          provider: { dataCollection: 'deny', requireParameters: true },
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
      { timeoutMs: TIMEOUT_MS },
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
