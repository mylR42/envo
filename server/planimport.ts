/**
 * IMPORT D'UN PLANNING FOURNISSEUR (0.8.0) : un PDF (livraisons, poses,
 * interventions d'un sous-traitant…) + les consignes de l'artisan → une
 * PROPOSITION d'import, ligne à ligne → « Valider l'import ».
 *
 * ⚠️ Deux temps, jamais un :
 * 1. La PROPOSITION (`preparerImport`) : Claude lit le PDF, interroge Interfast
 *    en LECTURE (chantiers, clients, intervenants, planning déjà saisi pour les
 *    doublons) et rend, par l'outil local `proposer_import`, une ligne par
 *    élément à créer avec l'outil d'écriture Interfast et ses arguments exacts.
 *    Les outils d'écriture lui sont DÉCRITS (nom, schéma), jamais donnés : il ne
 *    peut pas les appeler.
 * 2. L'IMPORT : seulement au « Valider l'import », depuis le serveur, avec les
 *    arguments EXACTS montrés à l'écran, pour les lignes cochées
 *    (server/app.ts). Une ligne dont l'outil n'est pas un outil d'écriture
 *    connu n'est pas importable.
 *
 * Le PDF n'est jamais gardé : il part à Claude et c'est tout. La proposition
 * est gardée (table `imports`) comme trace des écritures proposées.
 */
import type { BetaContentBlockParam, BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { modelName } from './agent';
import { isWriteTool, type McpTool } from './mcp';
import { collectRead, type CollectDeps } from './overview';

export const PDF_MAX_BYTES = 8 * 1024 * 1024;

export interface ImportLine {
  date: string;
  debut: string;
  fin: string;
  objet: string;
  chantier: string;
  intervenant: string;
  remarque: string;
  /** Nom de l'outil Interfast (sans préfixe), "" si la ligne n'est pas importable. */
  outil: string;
  arguments: Record<string, unknown>;
  doublon: boolean;
  /** Vrai si `outil` est un outil d'écriture d'Interfast connu. */
  importable: boolean;
}

export interface ImportProposal {
  fournisseur: string;
  resume: string;
  lignes: ImportLine[];
  ignores: string[];
  manques: string[];
}

export const PROPOSE_IMPORT: BetaTool = {
  name: 'proposer_import',
  description: 'Rend la proposition d’import à l’artisan. À appeler UNE fois, à la fin. RIEN n’est écrit : l’artisan valide ligne à ligne.',
  input_schema: {
    type: 'object',
    properties: {
      fournisseur: { type: 'string', description: 'Le fournisseur ou sous-traitant, tel qu’écrit dans le PDF.' },
      resume: { type: 'string', description: 'Deux phrases : ce que contient le PDF et ce qui est proposé.' },
      lignes: {
        type: 'array',
        description: 'Une ligne par élément à créer dans le planning Interfast (100 au plus), dans l’ordre chronologique.',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'AAAA-MM-JJ' },
            debut: { type: 'string', description: 'HH:MM ou ""' },
            fin: { type: 'string', description: 'HH:MM ou ""' },
            objet: { type: 'string', description: 'Ce qui est planifié, en clair.' },
            chantier: { type: 'string', description: 'Chantier ou client Interfast retenu (nom lisible), ou "" si introuvable.' },
            intervenant: { type: 'string', description: 'Personne ou équipe affectée, ou "".' },
            remarque: { type: 'string', description: 'Ce que l’artisan doit savoir (rapprochement incertain, consigne appliquée…), ou "".' },
            outil: { type: 'string', description: 'Nom EXACT (avec le préfixe if_) de l’outil d’écriture Interfast qui créera cet élément, ou "" si la ligne ne peut pas être importée telle quelle.' },
            arguments: { type: 'object', description: 'Arguments EXACTS de cet outil, conformes à son schéma, avec les identifiants lus dans Interfast. {} si outil vaut "".' },
            doublon: { type: 'boolean', description: 'Vrai si un élément équivalent existe déjà dans le planning Interfast.' },
          },
          required: ['date', 'debut', 'fin', 'objet', 'chantier', 'intervenant', 'remarque', 'outil', 'arguments', 'doublon'],
        },
      },
      ignores: { type: 'array', items: { type: 'string' }, description: 'Ce qui a été laissé de côté dans le PDF, et pourquoi (consigne, hors période…).' },
      manques: { type: 'array', items: { type: 'string' }, description: 'Ce qui empêche ou limite l’import (outil absent, chantier introuvable…).' },
    },
    required: ['fournisseur', 'resume', 'lignes', 'ignores', 'manques'],
  },
};

/** Les outils d'écriture, DÉCRITS au modèle (jamais donnés comme outils). Bornés à ~30 000 caractères. */
export function describeWriteTools(tools: McpTool[]): string {
  let out = '';
  for (const t of [...tools].filter(isWriteTool).sort((a, b) => a.name.localeCompare(b.name))) {
    const one = `### ${modelName(t.name)}\n${(t.description ?? t.title ?? '').slice(0, 800)}\nSchéma des arguments : ${JSON.stringify(t.inputSchema ?? {}).slice(0, 3000)}\n\n`;
    if (out.length + one.length > 30_000) break;
    out += one;
  }
  return out || 'AUCUN — Interfast ne propose pas d’outil d’écriture : aucune ligne ne pourra être importée (outil "", et dis-le dans "manques").';
}

export function importPrompt(today: string, writeTools: string): string {
  return `Tu prépares l'import d'un planning de fournisseur (ou de sous-traitant) dans le planning Interfast d'une entreprise du bâtiment. Date du jour : ${today}.

L'artisan te donne un PDF et des consignes. Ses CONSIGNES PRIMENT : ce qu'il faut garder ou laisser, à qui affecter, sur quel chantier, quels horaires par défaut.

Méthode :
1. Lis le PDF : chaque livraison, pose, intervention ou rendez-vous daté.
2. Applique les consignes. Ce que tu écartes va dans "ignores", avec la raison.
3. Rapproche chaque élément d'Interfast avec les outils "if_" (lecture seule) : chantier ou client, intervenant, et le planning déjà saisi sur ces dates pour repérer les DOUBLONS.
4. Pour chaque élément à créer, choisis l'outil d'écriture adapté parmi ceux listés plus bas et écris ses arguments EXACTS, conformes à son schéma, avec les identifiants LUS dans Interfast.
5. Appelle proposer_import, une seule fois.

RÈGLES ABSOLUES :
- Tu n'écris rien dans Interfast : tu PROPOSES. L'artisan valide ligne à ligne, puis le serveur exécute exactement tes arguments.
- N'invente jamais un identifiant, un chantier, un client, une date ou un horaire. Si un chantier est introuvable ou ambigu, mets outil "" et arguments {}, et explique dans "remarque".
- Une date illisible ou un élément sans date : dans "ignores".

# Outils d'écriture d'Interfast (pour les arguments ; tu ne peux PAS les appeler)

${writeTools}`;
}

/* ---------------- Nettoyage ---------------- */

const s = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
const hhmm = (v: unknown) => (/^\d{2}:\d{2}$/.test(s(v, 5)) ? s(v, 5) : '');

/** Borne la proposition et vérifie chaque outil : un outil d'écriture CONNU, sinon la ligne n'est pas importable. PUR, testé. */
export function sanitizeProposal(input: unknown, tools: McpTool[]): ImportProposal {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const writers = new Map(tools.filter(isWriteTool).map((t) => [modelName(t.name), t.name]));
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);
  const lignes = list(o.lignes, 100).map((l): ImportLine => {
    const r = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
    const asked = s(r.outil, 80);
    const real = writers.get(asked) ?? writers.get(modelName(asked)) ?? '';
    const args = r.arguments && typeof r.arguments === 'object' && !Array.isArray(r.arguments) ? (r.arguments as Record<string, unknown>) : {};
    // Des arguments démesurés ne partent pas : 20 ko par ligne au plus.
    const okSize = JSON.stringify(args).length <= 20_000;
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(s(r.date, 10)) ? s(r.date, 10) : '',
      debut: hhmm(r.debut),
      fin: hhmm(r.fin),
      objet: s(r.objet),
      chantier: s(r.chantier),
      intervenant: s(r.intervenant, 120),
      remarque: s(r.remarque, 400),
      outil: real,
      arguments: real && okSize ? args : {},
      doublon: r.doublon === true,
      importable: !!real && okSize,
    };
  });
  return {
    fournisseur: s(o.fournisseur, 120),
    resume: s(o.resume, 500),
    lignes: lignes.filter((l) => l.objet || l.date),
    ignores: list(o.ignores, 30).map((x) => s(x, 300)).filter(Boolean),
    manques: list(o.manques, 10).map((x) => s(x, 300)).filter(Boolean),
  };
}

/** Un PDF ? (les cinq premiers octets : « %PDF- »). */
export const isPdf = (b: Buffer) => b.length > 5 && b.subarray(0, 5).toString('latin1') === '%PDF-';

export async function preparerImport(d: CollectDeps, pdf: Buffer, fileName: string, consignes: string): Promise<ImportProposal> {
  const intro: BetaContentBlockParam[] = [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') }, title: fileName.slice(0, 120) || 'planning.pdf' },
    { type: 'text', text: `Consignes de l'artisan :\n${consignes.trim() || '(aucune : importe tout ce qui est daté)'}` },
  ];
  const r = await collectRead(
    { ...d, recipe: [] },
    {
      system: importPrompt(d.today, describeWriteTools(d.mcpTools)),
      publish: PROPOSE_IMPORT,
      sanitize: (input) => sanitizeProposal(input, d.mcpTools),
      intro,
      effort: 'medium',
      maxTokens: 32000,
    },
  );
  return r.data;
}
