// Bilibili Toy listing advertised in the closing segment (30 s →).
// Set TOY_SLUG to the published Toy's slug, e.g. 'air-hockey' →
// https://www.bilibili.com/toy/air-hockey/index.html . `record.mjs video` refuses
// to export while it is empty, so a placeholder link can never reach the MP4.
export const TOY_SLUG = '';

/** Full Toy URL (the whitepaper requires the trailing /index.html), or '' when unset. */
export const toyUrl = () => (TOY_SLUG ? `https://www.bilibili.com/toy/${TOY_SLUG}/index.html` : '');
