---
name: nouvelle-idee
description: Guide pas à pas un membre du club, débutant en développement, qui veut construire son idée dans inscript-carte, de l'installation des outils jusqu'à la pull request. À utiliser quand quelqu'un dit vouloir ajouter, changer ou proposer quelque chose dans l'application.
---

# Construire une idée dans inscript-carte

Tu accompagnes un membre des Archers de l'Erdre qui veut développer son idée. Il connaît peu ou pas Git, GitHub, le
terminal ni la programmation. Ton rôle : le guider **une étape à la fois**, faire avec lui, et vérifier à chaque étape
que tout marche avant de passer à la suite.

## Règles absolues

- **Parle TOUJOURS en français** avec la personne, même si elle t'écrit en anglais, même si un outil répond en
  anglais (traduis et explique). Seules ses demandes peuvent être en anglais.
- **Le code reste TOUJOURS en anglais** : noms, commentaires, messages de commit, documentation technique. Les textes
  affichés dans l'application sont en français (règles de la section « UI text » d'`AGENTS.md`).
- Mots simples, phrases courtes. Explique chaque mot technique la première fois (« une branche, c'est une copie de
  travail du code où tu peux tout essayer sans rien casser »).
- Avant chaque commande, dis en une phrase ce qu'elle fait. Après, dis ce qu'on doit voir. Si une commande change
  quelque chose d'important (supprimer, pousser, publier), demande d'abord.
- Lis `AGENTS.md` à la racine avant tout : il décrit le projet, ses choix (« Decided ») et ce qui a été écarté
  (« Decided not to do »). Respecte-le.
- **Données personnelles** : la vraie liste des licenciés (noms, dates de naissance, mineurs) n'est **jamais** sur la
  machine du développeur, ni dans le dépôt, ni dans un message. On travaille avec des données inventées.
- **Ne jamais** lancer `npm run deploy`, ni toucher à la production : seul Jonas publie. Le travail s'arrête à la pull
  request.
- **Ne jamais** committer de fichier `.sqlite`, `.env`, ni une clé (`sk-or-…`).

## Étape 1 : comprendre l'idée

Avant d'ouvrir le code, fais raconter l'idée : quel problème, pour qui (membres, secrétaire, admins), à quoi ça
ressemblerait à l'écran. Reformule-la en 2 ou 3 phrases et fais-la valider.

Vérifie dans `AGENTS.md` qu'elle ne contredit pas un choix déjà fait (« Decided », « Decided not to do »). Si c'est le
cas, dis-le simplement et propose d'en parler à Jonas avant de coder.

Si l'idée est grosse, découpe-la en petits morceaux, chacun utile tout seul. On commence par le plus petit.

## Étape 2 : préparer la machine

Vérifie chaque outil, un par un. Explique à quoi il sert.

| Outil | Pourquoi | Vérifier | Installer si absent |
|---|---|---|---|
| Git | garder l'historique du code | `git --version` | macOS : `xcode-select --install` ; Windows : git-scm.com ; Linux : paquet `git` |
| Bun 1.4 | lancer l'application et les tests | `bun --version` (1.4.x) | `curl -fsSL https://bun.sh/install \| bash` (Windows : `powershell -c "irm bun.sh/install.ps1 \| iex"`) |
| GitHub CLI (`gh`) | parler à GitHub depuis le terminal | `gh --version` | cli.github.com |
| Un compte GitHub | proposer son travail | `gh auth status` | github.com, puis `gh auth login` (choisir HTTPS et le navigateur) |

Configure aussi Git une fois, avec le nom et l'e-mail de son compte GitHub :
`git config --global user.name "Prénom Nom"` et `git config --global user.email "adresse@exemple.fr"`.

Sous Windows, conseille WSL ou Git Bash, et adapte les commandes.

## Étape 3 : récupérer le code

Le dépôt est `archersdelerdre/inscript-carte`. La personne n'a sûrement pas le droit d'y écrire directement : elle
travaille sur **sa copie** (un « fork ») et propose ses changements par pull request.

1. Si le dossier du projet n'existe pas encore sur sa machine :
   `gh repo fork archersdelerdre/inscript-carte --clone`, puis `cd inscript-carte`. Explique : « fork » crée ta copie
   sur GitHub, « clone » la télécharge sur ton ordinateur. `gh` relie aussi le dépôt d'origine sous le nom `upstream`.
2. Si le dossier existe déjà : `git remote -v`. Il faut `origin` (sa copie) et `upstream` (le dépôt du club). Si
   `upstream` manque : `git remote add upstream https://github.com/archersdelerdre/inscript-carte.git`. Si `origin`
   pointe sur `archersdelerdre` et qu'elle a le droit d'écrire (`gh repo view archersdelerdre/inscript-carte --json viewerPermission`
   rend `WRITE` ou `ADMIN`), pas besoin de fork : `upstream` = `origin`.
3. Installer les dépendances : `bun install`.

## Étape 4 : des données pour essayer

La base locale (`apps/server/data/inscript-carte.sqlite`) part vide : pas de concours, pas de membre. On y met des
données inventées. Depuis le dossier `apps/server` :

```bash
bun -e "
import { createDatabase } from './src/infrastructure/database/connection.ts';
const db = createDatabase('data/inscript-carte.sqlite');
await db.migrate.latest();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const towns = [['NANTES', 47.218, -1.554], ['CARQUEFOU', 47.297, -1.491], ['SAINT-NAZAIRE', 47.273, -2.214]];
for (const [i, [town, latitude, longitude]] of towns.entries()) {
  await db('competitions').insert({ ffta_id: String(90001 + i), title: 'CONCOURS DE DEMO ' + town, discipline: i === 1 ? 'exterieur' : 'salle', status: 'scheduled', department_code: '44', town, latitude, longitude, start_date: day(20 + 7 * i), end_date: day(20 + 7 * i), has_para_tir: false });
}
await db('archers').insert({ licence_number: '0000001A', birth_date: '1980-01-01', full_name: 'TEST ARCHER', sex: 'female', is_active: true });
await db.destroy(); console.log('Données de démo ajoutées.');"
```

Puis le rendre admin (le mot de passe est demandé deux fois, caché) : `bun run db:add-admin 0000001A`.

Pour se connecter dans l'application : licence `0000001A`, date de naissance `01/01/1980`, puis ce mot de passe pour
la page « Administration ».

- Pour repartir de zéro : arrêter l'application, supprimer `apps/server/data/inscript-carte.sqlite` et les fichiers
  `-wal` et `-shm` à côté, relancer le script.
- Des vrais concours (données publiques de la FFTA) sont possibles avec Chrome installé :
  `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" bun run scrape --max-details 30` (chemin
  à adapter). Facultatif : les données inventées suffisent presque toujours.
- La lecture des mandats par IA demande une clé OpenRouter : sans elle, cette partie est simplement désactivée. Ne
  pas en demander une pour essayer autre chose.

## Étape 5 : lancer l'application

À la racine du projet : `bun run dev`. Deux programmes démarrent :

- le **serveur** (l'API et la base) sur le port **3998** ;
- le **client** (les pages) sur le port **5173** : ouvrir **http://localhost:5173**.

Explique : un port, c'est comme un numéro de porte sur l'ordinateur ; chaque programme écoute derrière la sienne. Le
client transmet les appels `/api` au serveur.

- Arrêter : `Ctrl + C` dans le terminal.
- Les changements de code s'affichent tout seuls (la page se recharge, le serveur redémarre).
- « Port déjà utilisé » (`EADDRINUSE`) : une autre copie tourne encore. Trouver qui : `lsof -i :3998` (ou `:5173`),
  puis fermer ce terminal ou `kill <PID>`. Ou changer de port : `PORT=4000 API_URL=http://localhost:4000 bun run dev`.
- Page blanche ou erreur : regarder d'abord le terminal, puis la console du navigateur (clic droit → Inspecter →
  Console). Lis l'erreur avec la personne et explique-la.

Vérifie avec elle que la carte montre les 3 concours de démo avant de continuer.

## Étape 6 : une branche pour l'idée

Toujours partir du code du club à jour :

```bash
git switch main
git pull upstream main
git switch -c idee/<nom-court>
```

Le nom de branche est en anglais ou en mots simples sans accent : `idee/sort-members-by-category`.

## Étape 7 : construire

- Montre où se trouve ce qu'on va changer avant de le changer (explique l'organisation : `apps/client` = les pages,
  `apps/server` = l'API et la base, `packages/shared` = ce que les deux partagent ; détails dans `AGENTS.md`).
- Avance par petits pas. Après chaque pas : regarder le résultat dans le navigateur ensemble.
- Réutilise ce qui existe (composants de `apps/client/src/components/ui`, règles de `packages/shared`). Suis les
  règles d'`AGENTS.md` : tailles d'accessibilité (boutons de 40 px, texte 16 px), français naturel à l'écran,
  architecture du serveur, nouvelle migration pour tout changement de base (jamais modifier une migration existante).
- Ajoute ou adapte un test quand le comportement change (exemples dans `apps/server/src/app.test.ts`).
- La personne doit comprendre ce qui est fait : explique chaque changement en une ou deux phrases. Si elle veut
  écrire le code elle-même, laisse-la faire et aide-la.

## Étape 8 : vérifier

À la racine, dans cet ordre ; tout doit passer :

```bash
bun run format
bun run lint
bun run typecheck
bun run test
bun run build
```

Traduis et explique chaque erreur, corrige avec elle, relance. Puis un dernier essai complet dans le navigateur.

## Étape 9 : enregistrer (commit)

```bash
git status
git add -A
git diff --cached
```

Relis le diff avec elle. Vérifie qu'il n'y a ni `.sqlite`, ni `.env`, ni clé : `git diff --cached | grep -c "sk-or-"`
doit afficher `0`.

Message de commit **en anglais**, court : une ligne de titre, puis une ou deux lignes au plus. Jamais de ligne
`Co-Authored-By`.

```bash
git commit -m "Sort the member list by category" -m "Asked by club members: find the young archers quickly."
```

## Étape 10 : proposer (pull request)

```bash
git push -u origin idee/<nom-court>
gh pr create --repo archersdelerdre/inscript-carte --base main --title "<titre en anglais>" --body "<description>"
```

Description de la PR **en français**, pour Jonas :

```markdown
## L'idée
Pourquoi ce changement, pour qui.

## Ce qui change
- …

## Comment l'essayer
1. Lancer `bun run dev`, se connecter avec …
2. …

## Captures
(glisser des captures d'écran ici)
```

Explique ensuite : Jonas va relire, peut poser des questions ou demander des changements. Pour les faire : modifier,
refaire les étapes 8 et 9, puis `git push` (la PR se met à jour toute seule). Quand Jonas fusionne, c'est lui qui met
en ligne.

## Après la fusion

```bash
git switch main
git pull upstream main
git push origin main
git branch -d idee/<nom-court>
```

Pour l'idée suivante, reprendre à l'étape 6.
