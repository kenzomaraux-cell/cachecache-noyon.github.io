# CACHE-CACHE NOYON

Plateforme web mobile pour organiser des parties de cache-cache géant à Noyon. Cette première version est un site statique HTML/CSS/JavaScript relié à Firebase : les salons, participants, équipes, statut et heure de départ sont partagés en temps réel avec Cloud Firestore.

> État du livrable : le projet est prêt à configurer et à publier. Il n’est volontairement pas annoncé comme publié : il faut créer votre propre projet Firebase puis suivre les étapes ci-dessous.

## Fonctions incluses

- Accès organisateur réservé à une liste blanche d’UID Firebase définie à l’avance ; aucun bouton d’inscription ne donne ce droit.
- Chaque organisateur autorisé peut administrer toutes les parties : créer, ouvrir, fermer, lancer, terminer, modifier les équipes, saisir les résultats, supprimer une partie et exclure un joueur d’une salle.
- Création d’une partie, code de six caractères réellement unique (contrôlé dans une transaction Firestore) et lien d’invitation.
- Inscription d’un joueur avec un pseudo, validation du code, limite de joueurs et salle d’attente mise à jour en direct.
- Deux équipes : `🔴 Chercheurs` et `🔵 Cachés`, avec affectation manuelle ou automatique par l’organisateur.
- Ouverture/fermeture des inscriptions, démarrage et fin de la partie.
- Chronomètre calculé à partir de `startAt`, l’horodatage serveur Firestore : les téléphones n’enregistrent donc pas chacun leur propre temps de départ.
- Saisie d’un résultat et d’une note par l’organisateur à la fin de la partie.
- Indicateur de présence récente par battement Firestore. C’est une présence approximative (moins de 75 secondes), volontairement sans géolocalisation.

## Arborescence

```text
.
├── index.html                 # interface responsive
├── css/style.css              # identité visuelle et version mobile
├── js/app.js                  # logique Firebase et interface
├── js/firebase-config.js      # à compléter avec la configuration Web Firebase
├── firestore.rules            # règles de sécurité à déployer
├── .gitignore
└── README.md
```

## Configurer Firebase (gratuit)

1. Ouvrez [Firebase Console](https://console.firebase.google.com/) puis **Ajouter un projet**. Ne cochez pas Google Analytics si vous n’en avez pas besoin.
2. Dans **Authentication** → **Sign-in method**, activez **E-mail/Mot de passe** et **Anonyme**. Le premier sert uniquement aux organisateurs prédéfinis ; le second permet à un joueur de rejoindre sans créer de compte.
3. Dans **Firestore Database**, créez la base en mode production et choisissez une région proche de vos joueurs (par exemple `eur3` si elle est proposée). Une fois créée, ouvrez l’onglet **Rules**.
4. Copiez entièrement le contenu de [`firestore.rules`](firestore.rules) dans l’éditeur de règles et cliquez sur **Publier**.
5. Dans **Project settings** → **General** → **Your apps**, ajoutez une application Web. Copiez l’objet `firebaseConfig` affiché par Firebase dans [`js/firebase-config.js`](js/firebase-config.js), en conservant les noms de propriétés. Ces identifiants Web sont publics par conception : les droits sont protégés par les règles Firestore, pas par le masquage de cette configuration.
6. Dans **Authentication** → **Settings** → **Authorized domains**, ajoutez `votre-compte.github.io` après la publication. `localhost` est déjà prévu pour le test local.

### Définir les organisateurs à l’avance

Cette étape est indispensable : elle définit qui peut entrer dans l’administration.

1. Dans **Authentication** → **Users**, cliquez sur **Add user** et créez chaque compte organisateur (e-mail et mot de passe). Copiez son **User UID**.
2. Dans **Firestore Database** → **Data**, créez la collection `admins`.
3. Pour chaque organisateur, créez un document dont l’**ID du document est exactement son User UID**. Vous pouvez ajouter un champ informatif, par exemple `label` (chaîne : `Organisateur principal`). Aucun champ secret n’est nécessaire.
4. Publiez les règles de [`firestore.rules`](firestore.rules). Elles empêchent ensuite tout navigateur de créer, modifier ou supprimer des documents `admins`.

Un compte e-mail/mot de passe absent de `admins` peut se connecter à Firebase, mais le site lui refuse l’administration. Il ne peut ni créer une partie, ni lister les salles, ni modifier équipes, chronomètre ou résultats. Les joueurs anonymes ne voient jamais le tableau de bord.

### Pourquoi les droits sont protégés

Le code de partie ne donne pas de pouvoir d’administration. Les règles Firestore vérifient l’existence de `admins/<UID connecté>` à chaque opération sensible. Tous les UIDs préautorisés peuvent gérer toute partie, et aucun autre compte ne le peut. Un joueur ne peut modifier que sa propre date `lastSeen` ; il ne peut pas s’attribuer une équipe. Un organisateur peut l’exclure d’une salle ; cette exclusion reste enregistrée et bloque son retour dans cette salle.

La gestion des comptes **Firebase Authentication** eux-mêmes (création, changement d’e-mail ou suppression d’un compte organisateur) se fait dans la console Firebase. Une page statique GitHub Pages ne peut pas administrer Firebase Auth en sécurité : cette action nécessite la console ou un serveur Admin SDK distinct. En revanche, le site permet déjà aux organisateurs de gérer les joueurs de toutes les parties.

Ne modifiez pas les règles en `allow read, write: if true`. Testez les règles dans le simulateur de la console Firebase avec un UID organisateur et un UID joueur différents.

## Tester avant de publier

Le projet ne nécessite ni Node.js ni serveur applicatif.

1. Complétez `js/firebase-config.js`.
2. Depuis ce dossier, servez les fichiers avec un serveur statique. Avec Python installé :

   ```powershell
   python -m http.server 8080
   ```

   Puis ouvrez `http://localhost:8080`.
3. Créez un compte organisateur dans la console Firebase, ajoutez son UID à `admins`, puis connectez-vous dans une fenêtre normale et créez une partie.
4. Dans une fenêtre privée ou un autre navigateur, ouvrez la même adresse, saisissez un pseudo et le code. Vérifiez que le joueur apparaît instantanément dans les deux fenêtres.
5. Affectez les équipes et démarrez : les deux fenêtres doivent afficher le même temps à une seconde près. Testez aussi la fermeture des inscriptions, l’exclusion et la fin de partie. Un organisateur peut démarrer avec un seul joueur ; les joueurs encore non répartis reçoivent automatiquement une équipe au lancement.
6. Laissez une fenêtre en arrière-plan, revenez-y puis modifiez une équipe depuis l’autre fenêtre : les écouteurs Firestore se reconnectent automatiquement au retour au premier plan. Si un message de synchronisation persiste, ouvrez la console du navigateur : le problème vient alors généralement de règles Firestore non publiées ou du domaine Firebase non autorisé.
7. Sur Android et iPhone, ouvrez l’URL publiée dans Chrome/Safari. Testez avec deux appareils différents, réseau mobile compris. Il n’y a aucune application à installer.

## Publier gratuitement avec GitHub Pages

1. Créez un dépôt GitHub public, par exemple `cache-cache-noyon`.
2. Copiez ces fichiers dans le dépôt, en veillant à ce que `index.html` soit à la racine. Faites un commit puis poussez la branche `main`.
3. Dans GitHub : **Settings** → **Pages** → **Build and deployment** → source **Deploy from a branch** → branche `main` → dossier `/(root)` → **Save**.
4. Attendez la publication. L’adresse attendue est :

   ```text
   https://VOTRE-PSEUDO.github.io/cache-cache-noyon/
   ```

5. Ajoutez `VOTRE-PSEUDO.github.io` dans les domaines autorisés de Firebase Authentication, puis rechargez le site.
6. Créez une partie et utilisez **Copier le lien** : le lien contient le code et pré-remplit le formulaire de participation. C’est le lien à transmettre aux amis.

GitHub Pages héberge uniquement les fichiers statiques ; il ne remplace pas une base de données ou un contrôle d’accès. Firebase fournit ici l’authentification et Firestore la synchronisation en temps réel.

## Limites à connaître

- Cloud Firestore dispose actuellement d’un quota gratuit quotidien (notamment 50 000 lectures, 20 000 écritures et 20 000 suppressions par jour, avec 1 Gio stocké) sur une base gratuite. Les écouteurs temps réel et les battements de présence consomment des lectures/écritures ; pour un petit groupe c’est adapté, pour un très grand événement il faut surveiller l’usage. Consultez la [tarification Firestore](https://firebase.google.com/docs/firestore/pricing) avant un événement important.
- GitHub Pages est gratuit pour les dépôts publics avec GitHub Free ; il sert des fichiers statiques. Consultez la [documentation GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
- Le site ne suit aucune localisation et ne doit pas être utilisé comme outil de sécurité. L’organisateur doit fixer une zone, un point de rendez-vous, une tranche d’âge adaptée et un contact d’urgence hors du site si nécessaire.
- Supprimer une partie supprime le document de la partie ; Firestore ne supprime pas automatiquement les documents de la sous-collection `players`. Ils deviennent inaccessibles et restent à faible volume. Pour une gestion de masse, il faudrait une Cloud Function ou un nettoyage manuel — ce n’est pas requis par la première version et ne doit pas être ajouté sans vérifier les coûts.

## Conseils de jeu responsable

Définissez avant le départ une zone piétonne claire, une heure de retour et un adulte référent pour les mineurs. Ne jamais traverser une route en courant, se cacher dans une zone dangereuse, entrer dans un lieu privé ou gêner les habitants/commerçants.
