# Politique de confidentialité de TFT Stats

> **BROUILLON du 14/10/2026, à faire relire avant publication.** Il décrit l'édition publique telle qu'elle est
> prévue (application et serveur). Les passages entre [crochets] sont à compléter. Les utilisateurs étant en Europe,
> le RGPD s'applique : une relecture par une personne compétente est recommandée.

Dernière mise à jour : [date]

## Qui est responsable

TFT Stats est édité par [nom ou raison sociale], [adresse], joignable à [adresse e-mail] (ci-après « nous »).

TFT Stats n'est pas approuvé par Riot Games et ne reflète pas les opinions de Riot Games ni de quiconque
officiellement impliqué dans la production ou la gestion des propriétés de Riot Games.

## Quelles données, pourquoi, sur quelle base

| Données | Origine | Usage | Base légale |
|---|---|---|---|
| Ton identifiant Riot (PUUID) et ton Riot ID | Connexion avec ton compte Riot (Riot Sign On), quand tu l'utilises | Afficher tes propres parties et ta progression | Exécution du service que tu demandes |
| Tes parties classées TFT (placements, compositions, objets, niveau, or) | API officielle de Riot | Tes statistiques, ton récap et tes conseils d'après-partie | Exécution du service |
| Parties classées d'autres joueurs, avec leur identifiant Riot (PUUID) et leur rang | API officielle de Riot | Uniquement pour calculer des statistiques globales et le rang de chaque partie. **Aucun autre joueur n'est nommé ni affiché.** | Intérêt légitime : fournir des statistiques agrégées |
| Données de ton client League of Legends (ton historique récent, tes augments, le début d'une partie) | Ton propre PC, lues par l'application | Le récap d'après-partie et l'ouverture de l'overlay | Exécution du service. **Ces données restent sur ton PC.** |
| Augments que tu notes, réglages de l'application | Toi | Ton suivi personnel | Exécution du service. **Stockés sur ton PC.** |
| Données techniques (adresse IP, date des requêtes) | Ton accès au serveur | Sécurité et bon fonctionnement | Intérêt légitime |

Nous ne vendons aucune donnée. [Si publicité : préciser la régie, les données transmises et le consentement
demandé.] [Sinon : aucune publicité ni traceur publicitaire.]

## Où et combien de temps

- **Sur ton PC** : tes données locales restent dans le dossier `data/` de l'application. Tu peux les supprimer à tout
  moment en supprimant ce dossier.
- **Sur notre serveur** : hébergé par [hébergeur] en [pays]. Les parties et les identifiants des joueurs sont gardés
  [durée, par exemple : le set en cours et le précédent], puis supprimés. Les journaux techniques : [durée, par exemple 30 jours].
- Transferts hors de l'Union européenne : [aucun / préciser et les garanties].

## Tes droits

Tu peux demander l'accès à tes données, leur rectification, leur effacement, leur portabilité, la limitation de
leur traitement, et t'opposer à un traitement fondé sur l'intérêt légitime, en écrivant à [adresse e-mail]. Nous
répondons sous un mois. Si tu estimes que tes droits ne sont pas respectés, tu peux saisir la CNIL (cnil.fr) ou
l'autorité de ton pays.

Si tu te connectes avec ton compte Riot, tu peux retirer cet accès à tout moment depuis ton compte Riot.

## Sécurité

Toutes les connexions au serveur sont chiffrées (HTTPS). La clé de l'API Riot reste sur notre serveur et n'est
jamais incluse dans l'application. L'application n'écoute que sur ton propre PC (adresse 127.0.0.1).

## Modifications

Nous indiquerons toute modification importante de cette politique dans l'application et sur [site], avec sa date.
