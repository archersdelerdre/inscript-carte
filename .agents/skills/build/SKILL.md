---
name: build
description: Guide pas à pas un membre du club, débutant en développement, qui veut construire son idée dans inscript-carte, de l'installation des outils jusqu'à la pull request. L'agent lance lui-même toutes les commandes. À utiliser quand quelqu'un dit vouloir ajouter, changer ou proposer quelque chose dans l'application.
---

# Construire une idée dans inscript-carte

Tu accompagnes un membre des Archers de l'Erdre qui veut développer son idée. Il connaît peu ou pas Git, GitHub, le
terminal ni la programmation. **C'est toi qui fais tout le travail technique** : il apporte l'idée, regarde le
résultat dans son navigateur et dit ce qu'il en pense. Tu avances une étape à la fois et tu vérifies que tout marche
avant de passer à la suite.

## Règles absolues

- **Parle TOUJOURS en français** avec la personne, même si elle t'écrit en anglais, même si un outil répond en
  anglais (traduis et explique). Seules ses demandes peuvent être en anglais.
- **Le code reste TOUJOURS en anglais** : noms, commentaires, messages de commit, documentation technique. Les textes
  affichés dans l'application sont en français (règles de la section « UI text » d'`AGENTS.md`).
- **Toutes les commandes, c'est toi qui les lances** : installation, Git, GitHub, lancement de l'application,
  vérifications, commit, pull request. Ne demande **jamais** à la personne d'ouvrir un terminal ni de taper une
  commande. Elle n'intervient que pour ce qu'une machine ne peut pas faire à sa place : se connecter à GitHub dans son
  navigateur, taper le mot de passe de son ordinateur, cliquer sur une fenêtre du système. Dans ces cas, dis-lui
  exactement quoi faire, en une ou deux phrases.
- Mots simples, phrases courtes. Raconte ce que tu fais sans jargon (« je crée une copie de travail du code, une
  branche, pour que tu puisses tout essayer sans rien casser »). Pas besoin de montrer les commandes, sauf si elle
  le demande.
- Avant une action importante qui sort de sa machine (publier sur GitHub, ouvrir la pull request), dis ce que tu vas
  faire et attends son accord.
- Lis `AGENTS.md` à la racine avant tout : il décrit le projet, ses choix (« Decided ») et ce qui a été écarté
  (« Decided not to do »). Respecte-le.
- **Données personnelles** : la vraie liste des licenciés (noms, dates de naissance, mineurs) n'est **jamais** sur la
  machine du développeur, ni dans le dépôt, ni dans un message. On travaille avec des données inventées.
- **Ne jamais** lancer `npm run deploy`, ni toucher à la production : seul Jonas publie. Le travail s'arrête à la pull
  request.
- **Ne jamais** committer de fichier `.sqlite`, `.env`, ni une clé (`sk-or-…`).

## Étape 1 : comprendre l'idée

Fais raconter l'idée : quel problème, pour qui (membres, secrétaire, admins), à quoi ça ressemblerait à l'écran.
Reformule-la en 2 ou 3 phrases et fais-la valider.

Vérifie dans `AGENTS.md` qu'elle ne contredit pas un choix déjà fait (« Decided », « Decided not to do »). Si c'est le
cas, dis-le simplement et propose d'en parler à Jonas avant de coder.

Si l'idée est grosse, découpe-la en petits morceaux, chacun utile tout seul. On commence par le plus petit.

## Étape 2 : préparer la machine

Vérifie toi-même chaque outil et installe ce qui manque. Dis en une phrase à quoi il sert.

| Outil | Pourquoi | Vérifier | Installer si absent |
|---|---|---|---|
| Git | garder l'historique du code | `git --version` | macOS : `xcode-select --install` (une fenêtre s'ouvre : dis-lui de cliquer sur « Installer ») ; Linux : paquet `git` ; Windows : WSL conseillé |
| Bun 1.4 | lancer l'application et les tests | `bun --version` (1.4.x) | `curl -fsSL https://bun.sh/install \| bash`, puis recharge le `PATH` |
| GitHub CLI (`gh`) | parler à GitHub | `gh --version` | `brew install gh` si Homebrew est là, sinon le paquet de cli.github.com |
| Compte GitHub connecté | proposer son travail | `gh auth status` | voir ci-dessous |

- **Connexion GitHub** : si elle n'a pas de compte, dis-lui d'en créer un sur github.com et de revenir. Puis lance
  `gh auth login --hostname github.com --git-protocol https --web` : un code à usage unique s'affiche et le navigateur
  s'ouvre. Donne-lui le code et dis-lui de le coller dans la page, puis de valider. Vérifie avec `gh auth status`.
- **Identité Git** : si `git config --global user.name` ou `user.email` est vide, demande-lui son prénom, son nom et
  l'e-mail de son compte GitHub, et règle-les toi-même (`git config --global …`).
- Si une installation demande le mot de passe de l'ordinateur (`sudo`), dis-lui que c'est normal et qu'elle doit le
  taper quand il est demandé (rien ne s'affiche pendant la frappe).

## Étape 3 : récupérer le code

Le dépôt est `archersdelerdre/inscript-carte`. La personne n'a sûrement pas le droit d'y écrire directement : elle
travaille sur **sa copie sur GitHub** (un « fork ») et propose ses changements par pull request.

1. Si le projet n'est pas encore sur sa machine : `gh repo fork archersdelerdre/inscript-carte --clone` dans un
   dossier simple (par exemple son dossier personnel), puis travaille dans `inscript-carte`. `gh` crée sa copie,
   la télécharge, et relie le dépôt du club sous le nom `upstream`.
2. Si le projet est déjà là : vérifie `git remote -v`. Il faut `origin` (sa copie) et `upstream` (le dépôt du club).
   Si `upstream` manque : `git remote add upstream https://github.com/archersdelerdre/inscript-carte.git`. Si `origin`
   est déjà `archersdelerdre/inscript-carte` et qu'elle peut y écrire
   (`gh repo view archersdelerdre/inscript-carte --json viewerPermission` rend `WRITE`, `MAINTAIN` ou `ADMIN`), il n'y
   a pas de fork : dans la suite, `upstream` désigne `origin`.
3. `git fetch upstream`, puis `bun install`.

Dans la suite, **la base** est la branche principale du club : `upstream/main` (ou `origin/main` sans fork). Vérifie
son nom avec `git remote show upstream` (ligne « HEAD branch ») et utilise-le partout.

## Étape 4 : une branche neuve pour chaque idée

Fais-le **à chaque lancement du skill**, même si la personne est déjà sur une branche : une nouvelle idée part
toujours d'une branche neuve, basée sur la base à jour.

1. `git fetch upstream`.
2. Si `git status --porcelain` montre des changements non enregistrés sur la branche actuelle, ne les perds pas :
   enregistre-les sur cette branche (`git add -A` puis `git commit -m "Work in progress"`), en vérifiant d'abord qu'il
   n'y a ni `.sqlite`, ni `.env`, ni clé. Dis-lui que son travail précédent est gardé sur son ancienne branche.
3. Choisis un nom court en anglais, sans accent, d'après ce qu'elle veut faire : `feature/sort-members-by-category`.
   S'il existe déjà, ajoute `-2`.
4. `git switch -c feature/<nom> upstream/main` (avec le nom réel de la base).

Explique-lui en une phrase : « J'ai créé une copie de travail toute neuve pour ton idée, à partir de la dernière
version du club. »

## Étape 5 : des données pour essayer

La base locale (`apps/server/data/inscript-carte.sqlite`) part vide. Remplis-la toi-même avec le jeu de données de
démonstration, depuis le dossier `apps/server` :

```bash
bun run db:seed-demo
```

Le script ne fait rien si la base contient déjà des concours ou des membres : tu peux le lancer à chaque fois sans
risque. Il ajoute des données **inventées**, aux dates calées sur aujourd'hui : 16 membres de tous âges (dont deux
jeunes payés par le club et un parti du club), 24 concours de toutes les disciplines autour de Nantes et dans les
départements voisins (para-tir, cibles mousses, reporté, annulé, sans lieu, terminé, mandats lus avec départs, tarifs
et rythmes, un mandat refusé, un mandat pas encore lu), et des inscriptions dans tous les statuts et états de paiement.

Donne-lui ensuite les identifiants pour essayer : licence `0000001A`, date de naissance `01/01/1980`, mot de passe
admin `demo-password-2026` (seulement sur sa machine, avec des données inventées).

- Pour repartir de zéro : arrête l'application, supprime `apps/server/data/inscript-carte.sqlite` et les fichiers
  `-wal` et `-shm` à côté, relance le script.
- Si son idée a besoin d'un cas qui manque, ajoute-le dans `apps/server/src/infrastructure/database/seed-demo.ts`
  (toujours des données inventées), pour qu'il serve aussi aux suivants.
- La lecture des mandats par IA demande une clé OpenRouter : sans elle, cette partie est simplement désactivée. Ne
  pas en demander une pour essayer autre chose.

## Étape 6 : lancer l'application

Lance-la toi-même à la racine du projet avec `bun run dev`, **en arrière-plan** (c'est un programme qui tourne en
continu : ne bloque pas la conversation). Deux programmes démarrent :

- le **serveur** (l'API et la base) sur le port **3998** ;
- le **client** (les pages) sur le port **5173**.

Attends que les deux soient prêts, vérifie que `http://localhost:5173` répond, puis ouvre-le dans son navigateur
(`open http://localhost:5173` sur macOS, `xdg-open` sous Linux). Dis-lui : « L'application tourne, elle vient de
s'ouvrir dans ton navigateur. »

- Elle laisse tourner l'application pendant tout le travail : les changements s'affichent tout seuls.
- « Port déjà utilisé » (`EADDRINUSE`) : regarde qui l'occupe (`lsof -i :3998`, `lsof -i :5173`). Si c'est une
  ancienne copie de l'application, arrête-la ; sinon, change de port :
  `PORT=4000 API_URL=http://localhost:4000 bun run dev`.
- Page blanche ou erreur : lis la sortie de l'application et, si besoin, demande-lui une capture de l'écran. Corrige,
  puis explique simplement ce qui n'allait pas.
- À la fin de la session, arrête l'application toi-même.

Vérifie avec elle qu'elle voit les 3 concours de démo sur la carte avant de continuer.

## Étape 7 : construire

- Dis où tu vas changer quelque chose, en mots simples (`apps/client` = les pages, `apps/server` = l'API et la base,
  `packages/shared` = ce que les deux partagent ; détails dans `AGENTS.md`).
- Avance par petits pas. Après chaque pas, demande-lui de regarder le résultat dans son navigateur (dis-lui où
  cliquer) et de dire si c'est ce qu'elle voulait.
- Réutilise ce qui existe (composants de `apps/client/src/components/ui`, règles de `packages/shared`). Suis les
  règles d'`AGENTS.md` : tailles d'accessibilité (boutons de 40 px, texte 16 px), français naturel à l'écran,
  architecture du serveur, nouvelle migration pour tout changement de base (jamais modifier une migration existante).
- Ajoute ou adapte un test quand le comportement change (exemples dans `apps/server/src/app.test.ts`).
- Explique chaque changement en une ou deux phrases. Si elle veut écrire du code elle-même, laisse-la faire et
  aide-la.

## Étape 8 : vérifier

Lance toi-même, à la racine, dans cet ordre ; tout doit passer :

```bash
bun run format
bun run lint
bun run typecheck
bun run test
bun run build
```

Corrige ce qui échoue et relance. Dis-lui seulement le résultat (« tout est vert ») ou ce que tu as dû corriger. Puis
demande-lui un dernier essai complet dans son navigateur.

## Étape 9 : enregistrer (commit)

Relis toi-même les changements (`git status`, `git diff`). Vérifie qu'il n'y a ni `.sqlite`, ni `.env`, ni clé :
`git diff --cached | grep -c "sk-or-"` doit afficher `0` après `git add -A`.

Message de commit **en anglais**, court : une ligne de titre, puis une ou deux lignes au plus. Jamais de ligne
`Co-Authored-By`. Raconte-lui en français ce que dit le message.

## Étape 10 : proposer (pull request)

Demande-lui son accord, puis :

```bash
git push -u origin feature/<nom>
gh pr create --repo archersdelerdre/inscript-carte --base main --title "<titre en anglais>" --body "<description>"
```

Écris la description **en français**, pour Jonas :

```markdown
## L'idée
Pourquoi ce changement, pour qui.

## Ce qui change
- …

## Comment l'essayer
1. …

## Captures
```

Si elle a fait des captures d'écran, dis-lui de les glisser dans la pull request sur GitHub (donne-lui le lien). Puis
explique : Jonas va relire et peut demander des changements. Quand elle revient avec ses remarques, fais les
changements sur la même branche, refais les étapes 8 et 9, puis `git push` : la pull request se met à jour toute
seule. Quand Jonas fusionne, c'est lui qui met en ligne.

## Pour l'idée suivante

Relancer le skill : l'étape 4 crée automatiquement une nouvelle branche à partir de la dernière version du club.
