// Thème choisi, appliqué avant l'affichage de la page (pas de flash). Fichier à part : la politique de sécurité
// (Content-Security-Policy) interdit les scripts écrits dans le HTML.
try { var t = localStorage.getItem('tft-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
