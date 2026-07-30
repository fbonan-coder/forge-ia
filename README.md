# Forge IA — socle multi-projet

Premier vertical slice serveur de Forge IA. Il fournit :

- une API REST pour créer, lister, ouvrir, archiver et réveiller des projets ;
- un espace de travail isolé par projet ;
- des conversations, exécutions, checkpoints et coûts séparés ;
- une base SQLite durable ;
- un agent simulé utilisable immédiatement ;
- un adaptateur optionnel pour Claude Agent SDK ;
- une petite console web pour tester le parcours complet.

## Démarrage

Prérequis : Node.js 24 ou plus récent.

```bash
npm install
cp .env.example .env
npm start
```

Ouvrir ensuite `http://localhost:8787`.

Le mode par défaut est `AGENT_PROVIDER=mock`. Il permet de vérifier tout le
gestionnaire multi-projet sans consommer de tokens.

## Activer Claude

Renseigner :

```dotenv
AGENT_PROVIDER=claude
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-5
```

L'adaptateur limite Claude au dossier du projet, aux outils de lecture/édition
et au budget configuré. Avant un usage public, exécuter chaque workspace dans
un conteneur ou une VM distincte : l'isolation par dossier du MVP n'est pas une
frontière de sécurité.

## API

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `POST /api/projects/:id/open`
- `POST /api/projects/:id/suspend`
- `POST /api/projects/:id/archive`
- `GET /api/projects/:id/messages`
- `POST /api/projects/:id/runs`
- `GET /api/projects/:id/runs`
- `GET /api/projects/:id/checkpoints`
- `POST /api/projects/:id/checkpoints`
- `GET /api/health`

## Ce qui reste à brancher

1. Fly Machines ou un fournisseur équivalent derrière `WorkspaceManager`.
2. Création et push du dépôt Git lors de la création d'un projet.
3. Serveur Vite et URL HMR par projet.
4. Gate `tsc` + lint + tests après chaque exécution.
5. Déploiement immuable lors d'un checkpoint.

