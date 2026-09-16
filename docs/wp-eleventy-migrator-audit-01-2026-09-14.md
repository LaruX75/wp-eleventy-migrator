# WP-ELEVENTY-MIGRATOR-AUDIT-01

Status: AUDIT COMPLETE / NO IMPLEMENTATION

Scope direction: **A (generic tool)** — apuri pysyy projekti-riippumattomana. Auditti
ei ehdota jarilaru.fi-spesifiä profiilia tai kohdennettua contentType-mappausta;
sellainen kuuluu erilliseen B-suuntaan.

Auditoitava repo: `/Users/jlaru/Documents/www/wp-eleventy-migrator/`
Baseline: `d68ddf789cb9f61a484596e9c6cd0887de620725` ("Update migrator tooling and UI",
2026-03-15).
Auditti tehty jarilaru.fi-repossa; migraattoriin ei kajottu.

## 1. Vahvistetut faktat (mitä engine tekee)

### 1.1 Skaala ja rakenne

- `scripts/wp-eleventy-migrate.mjs`: **5 287 riviä** yhdessä ESM-moduulissa.
  Repo-tason `CLAUDE.md` sanoo "~1,100 lines" — vanhentunut ~4,8×-kertoimella.
- Zero external dependencies paitsi `@anthropic-ai/sdk ^0.78.0` (`package.json:16`).
- Kolme entry-pointtia jakavat `runMigration()`-runkoa: `runWizard` (`:5106`),
  `runFromConfig` (`:5230`), `serveUi` (`:4874`).

### 1.2 runMigration()-pipeline (`:4133`)

1. Config-parsinta ja hakemistojen luonti (`:4134`, `:4167`)
2. Site-profile (jos annettu) (`:4171`)
3. Replacement scaffolding + Kadence partials + Nunjucks layouts (`:4182`–`:4218`)
4. Auth-headerit (`:4220`)
5. Kategoriat ja tagit (`:4234`)
6. Eleventy-projektin bootstrap + `npm install` (`:4245`)
7. Stylesheets (`:4248`)
8. Menut (REST → HTML-fallback → Kadence megamenu) (`:4269`–`:4345`)
9. Content-typet: fetch → parse → write (`:4350`–`:4469`)
10. `redirects.csv` (`:4470`)
11. Action items ja output-verifikaatio (`:4478`, `:4495`)
12. `migration-report.json` (`:4500`)

### 1.3 WP REST -kattavuus

Käytetyt endpointit:

- `/wp/v2/categories`, `/wp/v2/tags` — kielikohtaisesti `?lang=…` (`:4237`)
- `/wp/v2/types`, `/wp/v2/taxonomies` (`:4742`, `:4788`)
- `/wp/v2/{contentType}?_embed=1` (autentikoituna `context=edit`) (`:4355`)
- `/wp/v2/menus`, `/wp/v2/menu-items` (`:4795`, `:658`)
- Menu-fallbackit: `menus/v1`, `wp-api-menus/v2`, `/wp/v2/menus` (`fetchMenus`, `:874`)
- Kadence-omat post typet: `kadence_header`, `kadence_navigation` (`:753`, `:738`)

Pagination: `fetchAllPages()` (`:469`) hakee `per_page=100` ja iteroituu kunnes
`x-wp-totalpages` tai tyhjä vaste. Ei rate-limit-tunnistusta, ei retry-loopia,
ei exponential backoffia — yksi yritys per endpoint.

Autentikointi (`authMode`): `none`, `app-password` (Basic base64), `bearer`.
Headerit rakennetaan `:909`–`:920`.

Multilingual (WPML + Polylang) tunnistetaan `:5062`: `/wpml/v1/languages` tai
`/pll/v1/languages`. Kielikohtaiset fetchit tehdään `?lang=<code>`-parametrilla.

### 1.4 Kadence-blokkien käännös

- **32 blokkia** yhteensä: 18 Kadence-vakiota + 14 Pro-blokkia (`KADENCE_BLOCK_CSS`,
  `:52`–`:110`). README/CLAUDE.md puhuu 18:sta, mikä on Pro-blokit unohtava
  osatotuus.
- Parser: `parseWpBlocks()` `:2891` — regex tokenisoi `<!-- wp:name -->`-kommentit
  puuksi. Kadence-Pro sisältyy tuettuihin vain kun `preset === "kadence-pro"`
  (`:2935`).
- Fallback tuntemattomille: `unknownKadenceBlockStrategy` — `fallback-html`
  (default) tai `comment-only` (`:3038`–`:3040`).
- TODO-jäänteet `:3040`, `:3043`, `:3585`, `:3824`, `:3859`, `:3881`, `:3892`,
  `:3906` — pääosin "content must be restored manually" ja layout-template-vajeita.

### 1.5 Front matter (`itemToDoc()`, `:4038`)

Tuotettu YAML-kenttäjoukko: `title, date, updated, slug, permalink, status,
sourceType, sourceId, sourceUrl, excerpt, categories, tags, lang, author,
featuredImage, sticky, format, parent, menuOrder, layout, kadenceBlocks,
seoTitle, seoDescription, ogTitle, ogDescription, ogImage, canonical, noindex`
+ slugifioidut custom-taksonomiat.

YAML-safety (`yamlValue`, `:377`–`:394`): numeriset/booleanit passthrough,
taulukot listamuodossa, monirivinen `|-`-block scalar, erikoismerkkien
quotointi `JSON.stringify()`:llä. `toFrontMatter()` `:396` rakentaa `---`-rajat.

Slug: NFD-normalisointi + diakriittien poisto + `[^a-z0-9]→-` + reunaviivojen
trim, fallback `"entry"` (`:362`).

### 1.6 Media ja URL:t

- `downloadMedia`: `downloadFile()` `:892` (binäärinen fetch → kirjoitus `/media/`).
- `extractMediaUrls()` `:499`: kerää `src`, `srcset`, lazy-loadin `data-*` ja
  Kadence-blokkijson `url`/`link`/`src` -kentät.
- `rewriteWpMediaUrls()` `:524`: korvaa alkuperäiset WP-URL:t lokaaleilla
  `/media/`-poluilla.
- `redirects.csv` `:4471`: `source,destination,status` `301`-koodilla,
  `item.link → doc.permalink`.

### 1.7 HTML → Markdown (`basicHtmlToMarkdown`, `:407`)

Regex-pohjaiset korvaukset (h1–h6, strong/em, a href, img, li, br, p) ja lopuksi
`<[^>]+>`-strippaus. Kaksi moodia: `keep-html` (default, koskematon HTML) ja
`basic-markdown`. Ei tue tauluja, ei blockquoteja, ei koodilohkoja, ei
sisäkkäisiä listoja, ei attribuutteja ankkurissa/kuvissa (title, class).

### 1.8 Menu-import (`fetchMenus()`, `:874`)

Kolme yritysjärjestystä ennen HTML-fallbackia (`:4284`): (1) `menus/v1`,
(2) `wp-api-menus/v2` -plugin, (3) `/wp/v2/menus` + `/wp/v2/menu-items`.
Kadence-megamenu (`:4307`) haetaan `kadence_header` + `kadence_navigation`
post typeistä, kun `authMode !== "none"`.

`buildMenuTree()` `:595` rakentaa parent→children-puun ja kirjoittaa
`_data/navigation.json`.

### 1.9 Presetit

`none | kadence | kadence-pro` on kovakoodattu switch `:4516`–`:4534` —
`kadence` asettaa `useNunjucksLayouts, convertKadenceBlocks, migrateStyles`
todeksi ja `stylesDir="styles/kadence-legacy"`, `kadence-pro` sama +
Pro-blokit + `stylesDir="styles/kadence-pro-legacy"`. **Ei laajennus-API:a:**
uuden preset-nimen lisääminen vaatii kaksi lähdemuutosta (enum + switch-case).

### 1.10 Output

`content/<type>/*.md` (tai `.njk` Kadence-käännetylle),
`_includes/blocks/kadence/*.njk`, `_data/navigation.json`, `redirects.csv`,
`migration-report.json`, `site-profile.json` (+ summary). Dry-run skippaa
fs-kirjoitukset mutta tuottaa raportin.

`migration-report.json` (`:4135`, `:4497`): `startedAt, finishedAt, configPath,
sourceType, totals, redirects, warnings, actionItems{unsupportedBlocks,
shortcodes, suggestions}, styles, kadenceBlocks, menus, layouts, siteProfile`.

### 1.11 Apuskriptit (erilliset CLI:t)

- `fix-yaml-quotes.mjs` (95 riviä) — escapee `\"` unescape
- `validate-yaml.mjs` (32 riviä) — havaitsee rikkinäiset lainausparit
- `translate-missing.mjs` (233 riviä) — ei ajettu tarkistuksessa
- `visual-audit.mjs` (1 016 riviä) — CSS/DOM-audit yksittäissivulle tai koko
  sivustolle

**Havainto:** näitä ei kutsuta enginestä. `fix-yaml-quotes` ja `validate-yaml`
olemassaolo on itsessään signaali siitä, että `yamlValue`-toteutus (`:377`)
päästää läpi tapauksia jotka vaativat jälkikäteiskorjausta.

### 1.12 UI (`ui/index.html`)

Kolme askelta: **Analyze** → **Configure** → **Migrate**. API:
`POST /api/wp-analyze`, `GET /api/defaults`, `POST /api/pick-folder`,
`POST /api/migration-start`. Streamaava progress-loki.

## 2. Puutteet ja aukot (A-suunta: generic-tool)

Priorisoituna. **P0** = korjaus ennen seuraavaa migraatioerää, **P1** =
seuraava iteraatio, **P2** = tekninen velka.

### P0 — luotettavuus ja turvallisuus

| # | Aukko | Riski | Sijainti |
|---|---|---|---|
| P0-1 | **Ei rate-limitiä eikä retryä REST-fetcheissä.** Yksi 500/429 kaataa kokonaisen typen. `fetchAllPages` `:469` iteroi kunnes onnistuu tai kaatuu. | Suuret WP-instanssit (>1000 posts) tai Cloudflaren takana olevat siteit epäonnistuvat kesken migraation. | `:469`, `:874`, `:4355` |
| P0-2 | **`yamlValue` tarvitsee jälkikäsittelijän** (`fix-yaml-quotes.mjs`, `validate-yaml.mjs` olemassaolo todistaa). Root cause ei ole korjattu. | Front matter voi tuottaa Eleventy-buildin kaatavia YAML-virheitä hiljaisesti. | `:377`–`:394` |
| P0-3 | **Report ei sisällä coverage-metriikkaa:** "kuinka moni block/URL/media jäi käsittelemättä" ei ole eksplisiittinen. `actionItems.unsupportedBlocks` on lista, mutta ei prosenttia eikä diffiä. | Migraation "onnistuminen" on false-positive: dry-run raportoi silti kirjoitetun, tuntemattomat blokit hukkuvat lokiin. | `:4497` |

### P1 — laajennettavuus ja siisti generisyys

| # | Aukko | Vaikutus | Sijainti |
|---|---|---|---|
| P1-1 | **Preset-järjestelmä on suljettu.** Enum + switch — ei plugin-API:a eikä `configs/presets/*.json` -kansiota. Uusi kohdeprojekti = editoi engineä. | Toimii yhtenä tool-kokonaisuutena useille projekteille vain hyvin rajatusti. | `:4516`–`:4534` |
| P1-2 | **`basicHtmlToMarkdown` on liian karkea:** ei tauluja, blockquoteja, koodilohkoja, sisäkkäisiä listoja, kuvan/linkin `title`/`class`. `keep-html` on ainoa turvallinen moodi ei-triviaalille sisällölle. | Puolet WP-sisällöstä joudutaan pitämään HTML:nä, mikä vie hyödyn markdown-projekteista. | `:407` |
| P1-3 | **`unknownKadenceBlockStrategy` ei laajenna kolmannen osapuolen blokkeihin** (Elementor, GenerateBlocks, Spectra). Vain fallback-html / comment-only. | Ei-Kadence-WP:t tuottavat pelkkää HTML-massaa. | `:3038`–`:3040` |
| P1-4 | **REST-kattavuudessa aukot:** authors (`/wp/v2/users`), kommentit, revisiot, media library metadata (alt/caption itsenäisenä objektina), ACF-kentät, site settings. | Attribution puuttuu (Article JSON-LD:lle), alt-tekstit menetetään jos ei `<img alt>`:ssa. | `:4234`, `:4355` |
| P1-5 | **Multilingual on parittainen "extra rounds", ei todellinen sisarkoosto:** kielet fetchataan itsenäisesti eikä `translations`-relaatiota säilytetä (WPML kertoo `translations`-mapin, Polylang `translations`-avaimen). | Kohdeprojektin FI/EN-pariteetti on manuaalisen rekonstruktion varassa. | `:5062`–`:5106` |
| P1-6 | **Nunjucks-layoutit ovat TODO-täytettyjä** (`:3585, :3824, :3859, :3881, :3892, :3906`). | Kadence-preset lupaa layout-generoinnin mutta jättää käyttäjän täydentämään formit, sivupalkin ja loop-templaatit. | ks. yllä |

### P2 — tekninen velka ja siisteys

| # | Aukko | Sijainti |
|---|---|---|
| P2-1 | 5 287-rivinen monoliitti ilman modulointia — testaus, code review ja diff-luettavuus kärsivät. | `scripts/wp-eleventy-migrate.mjs` kokonaan |
| P2-2 | Ei testiajoja (`package.json` scripts: ei `test`). Ei linter-, ei formatter-konfiguraatiota. | `package.json:7`–`:14` |
| P2-3 | `CLAUDE.md`-kuvaus vanhentunut ~5×-kertoimella (1 100 → 5 287 riviä). Vanhentuu myös block-count (18 → 32). | `CLAUDE.md:17`, `:40` |
| P2-4 | `README.md` mainitsee `npm run migrate:wp:gui`; todellinen script `migrate:wp:gui` on olemassa, mutta portti "4173" mainitaan vain `CLAUDE.md`:ssä. | `README.md:24`, `CLAUDE.md:10` |
| P2-5 | Erilliset apuskriptit (`fix-yaml-quotes`, `validate-yaml`) eivät kytkeydy `runMigration()`in — käyttäjä ei tiedä että ne pitäisi ajaa. | `scripts/*.mjs` |
| P2-6 | `migrations/` säilyttää 6 aiempaa ajoa gitissä vain työskentelypuun ulkopuolella (untracked `_site/`, ei-ignorattu `migrations/`). Repo turpoaa hiljaisesti. | `.gitignore` |

## 3. Ei-havaittu (mitä auditti ei kata)

- Autentikoinnin todellinen turvallisuus (basic-auth over HTTPS oletettu — ei
  varmennettu ettei tokeneita logata).
- `visual-audit.mjs` ja `translate-missing.mjs` toiminta.
- `migrations/`-kansion sisällön tarkka rakenne (siellä pääosin
  `migration-config.json` ja site-profile-tiedostoja, ei täyttä content-outputtia
  tarkastelun perusteella).
- WP-instanssin plugin-kirjon reaalitesti (esim. Yoast SEO -kenttien todellinen
  poimintavarmuus).

## 4. Avoimet kysymykset päätöksentekoa varten

1. **Kohdeprojekti-kirjo:** onko realistista, että apuri palvelee useaa
   projektia rinnakkain, vai onko `generation-ai-stn.fi` ollut ainoa aktiivinen
   asiakas? Vastaus ratkaisee, kannattaako P1-1 (preset-laajennus).
2. **Kadence-Pro-jako:** jatkuuko Pro-blokkien tuki (14 lisäblokkia) vai
   voidaanko preset yksinkertaistaa yhdeksi "kadence"-tueksi?
3. **Markdown vs. HTML-passthrough:** onko tavoite tosiasiassa markdown-native
   Eleventy, vai riittääkö HTML pass-through (jolloin P1-2 romahtaa)?
4. **YAML-korjaus root-cause:** kirjoitetaanko `yamlValue` uudelleen käyttäen
   jotain kirjastoa (`js-yaml`) vai kutsutaanko `fix-yaml-quotes` osana
   `runMigration()`in loppua?
5. **Multilingual-mallin syvyys:** halutaanko `translations`-relaatio
   säilyttää output-YAML:ssa (esim. `translations: { en: "/en/…" }`) vai
   riittääkö erilliset kieliajot?

## 5. Pienin turvallinen seuraava toimenpide

Kun päätökset kohdista 4.1–4.5 on tehty:

1. **Rajaa P0-slotti** yhdeksi PR:ksi migraattori-repoon: P0-1 (retry +
   pagination-turvaus), P0-2 (`yamlValue`-refaktori kirjastopohjaiseksi), P0-3
   (report coverage-metriikka).
2. **Päivitä `CLAUDE.md`** samalla PR:llä oikeisiin rivimääriin ja block-count-
   lukuun.
3. **Ei aloiteta P1-työtä** ennen kuin P0 on merged ja seuraava migraatio
   validoi retryn ja coverage-raportin.

Handoff palautuu ChatGPT:lle päätöstä varten.
