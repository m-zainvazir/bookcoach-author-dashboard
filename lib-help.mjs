/**
 * lib-help.mjs — every step, and every problem, explained in plain words.
 *
 * Muhammad, 2026-10-02: "isn't it possible for this dashboard to provide me an
 * easy explanation, and provide me steps on what to do … for all the 17 steps,
 * wherever, whenever stuck."
 *
 * So for each step: what it is, why it matters, how to do it (numbered, with
 * where to click), and how you know it is done. And for each thing the live
 * checks can find wrong: what is wrong, in plain words, and the exact steps to
 * fix it — with THIS author's links, names and ids filled in.
 *
 * Pure, written once, no AI, costs nothing. Uses only public values — never a key.
 * Plan: ../ghl-shopify subscription/plans/22-pipeline-dashboard.md §16.
 */

import { withAuthor, courseDescription, zipifyPageName, zipifyHandle, zipifyMetaTitle, coachPageName, youtubeEmbed } from '../coach-router/lib-onboard.mjs';
import { STEP as S } from '../coach-router/steps.mjs';
import { bundleTitle, collectionTitle } from '../coach-router/lib-shopify.mjs';
import { DEFAULT_COURSE_MASTER_TITLE } from '../coach-router/lib-course360.mjs';

const SITE = 'https://www.book-coach.ai';

/** The values help text may use. A credential is never on this list. */
export const HELP_FIELDS = ['code', 'name', 'displayName', 'bookTitle', 'coachLabel', 'slug', 'ghlTag', 'ghlProductId', 'ghlPriceId',
  'shopifyProductId', 'shopifyVariantId', 'collectionProductId', 'collectionVariantId', 'landingPageUrl', 'courseLessonUrl', 'bookLandingUrl', 'authorPhotoURL', 'authorURL', 'books', 'videoUrl'];

export const publicValues = (coach = {}) => Object.fromEntries(HELP_FIELDS.filter((k) => coach[k] !== undefined && coach[k] !== null && coach[k] !== '').map((k) => [k, coach[k]]));

/** Everything a sentence might need, worked out once. Missing values read as a plain placeholder. */
function facts(v = {}) {
  const name = v.displayName || v.name || 'this author';
  const slug = v.slug || ((/^bookcoach-(.+)-active$/.exec(v.ghlTag || '') || [])[1]) || '';
  const label = v.coachLabel || v.bookTitle || 'the coach';
  return {
    name,
    first: String(name).split(/\s+/)[0],
    label,
    book: v.bookTitle || 'the book',
    code: v.code || '',
    slug,
    pageUrl: slug ? `${SITE}/${slug}` : 'book-coach.ai/<slug>',
    funnelUrl: v.landingPageUrl || (slug ? `${SITE}/${slug}-coach-access` : 'book-coach.ai/<slug>-coach-access'),
    tag: v.ghlTag || (slug ? `bookcoach-${slug}-active` : 'the coach tag'),
    product: `BookCoach AI - ${name} - Coach Access`,
    productId: v.ghlProductId || '(made at step 3)',
    priceId: v.ghlPriceId || '(made at step 3)',
    variant: v.shopifyVariantId || '',
    cartLink: v.shopifyVariantId ? `https://leadershipbooks.com/cart/${v.shopifyVariantId}:1` : '(made at step 4)',
    zipifyName: zipifyPageName(name, v.bookTitle),
    zipifyHandle: zipifyHandle(name, v.bookTitle),
    zipifyMetaTitle: zipifyMetaTitle(v.bookTitle || 'the book'),
    videoEmbed: youtubeEmbed(v.videoUrl),
    bundle: v.bookTitle ? bundleTitle(v) : 'this author’s bundle',
    collection: v.bookTitle ? collectionTitle(v) : '<Book title> - Collection Bundle',
    collectionCartLink: v.collectionVariantId ? `https://leadershipbooks.com/cart/${v.collectionVariantId}:1` : '',
    salesPage: v.bookLandingUrl || '',
    lesson: v.courseLessonUrl || '',
    courseName: `BookCoach AI — ${withAuthor(name, label, ' — ')}`,
    courseDescription: courseDescription(name),
    workflowName: `Book Coach — Grant Course (${name})`,
  };
}

/** A step of instructions: plain text, or text with a value to copy. */
const copy = (text, value) => ({ text, copy: value });

/* ============================================================ the 17 steps === */

export const STEP_HELP = {
  [S.inputs]: (f) => ({
    title: 'Write down who the author is',
    what: 'The basic facts the rest of the setup is built from: the author\'s name, the book, what the coach is called, and the web address for the coach page.',
    why: 'Every later step uses these. A typo here ends up on the coach page and in the emails.',
    how: [
      'Open the Onboard tab and pick this author (or + Add author for a new one).',
      'Type the Author name and the Book title.',
      'The Page slug (e.g. jane-smith) and the Coach label (e.g. "Jane Smith – Her Book") fill themselves in from those. Change either one if you want something else.',
      'Press Save.',
    ],
    done: 'All four boxes are filled in.',
  }),
  [S.voiceflow]: (f) => ({
    title: 'Build the AI coach in Voiceflow, then save its IDs',
    what: `The coach itself — the AI that talks like ${f.name}, trained on ${f.book}, built by hand in Voiceflow — and the two long codes that tell the system which Voiceflow coach is this author's.`,
    why: 'The coach is the product. Without its IDs it cannot answer anyone.',
    how: [
      'Build it in Voiceflow with the book-coach-ai-builder skill (prompts, knowledge base, playbooks).',
      `Chat with it for a minute: does it sound like ${f.name}, and does it know ${f.book}?`,
      'Version ID: make sure "Main" is selected at the top, then copy the 24-character code from your browser\'s address bar. Never type the word "main".',
      'Project ID: Settings → General → copy the Project ID (or leave it empty — it is worked out from the version).',
      'Paste them into this step and press Save. Saving the IDs is all this step needs — there is no tick box.',
    ],
    done: 'The version ID is saved.',
  }),
  [S.coachPage]: (f) => ({
    title: 'Put up the coach page',
    what: `The web page at ${f.pageUrl} where readers chat with the coach — with the author's photo, a link to their own website, and "Buy the book" buttons. It comes first: everything after it points here.`,
    why: 'It is where readers talk to the coach, and where customers press "Get my activation code" to switch on texting and calling.',
    how: [
      'Press "Open the page form" (or: Onboard tab → this author → step 2). It works before the author is created.',
      'Photo: open the author\'s photo online, right-click it → "Copy image address", and paste it.',
      'Author\'s own website: paste the author\'s OWN website — never another author\'s.',
      'Book buttons: one line per book, written as  Title|link-to-buy  (with the | in the middle).',
      'Press "Save and build the page". The whole page is made for this author and saved on your computer — you never edit code.',
      'Press "Copy the whole page".',
      'In GHL: Sites → Websites → the Book Coach site → duplicate any coach page (for example Freddy Davis).',
      copy('Name the new page ("Name for page")', coachPageName(f.name)),
      copy('Set the new page\'s path to', f.slug || '<slug>'),
      'Open the new page\'s Custom Code element. Click inside it, press Ctrl+A (select all), then Ctrl+V (paste over it).',
      'Save, then Publish.',
      'Press Refresh in the dashboard.',
    ],
    done: `${f.pageUrl} opens and shows ${f.name}.`,
  }),
  [S.ghl]: (f) => ({
    title: 'Create the author in the system',
    what: `One button creates three things in GHL — the coach tag (${f.tag}), the $59/month product and its price — and adds ${f.name} to the list of authors (coaches.json), with the page details from step 2.`,
    why: 'The tag is what gives a customer access. The product is what a $59 subscriber pays for.',
    how: [
      'Open the Onboard tab → step 3.',
      'Press "Preview (dry run)" and read what it will create. Nothing is created yet.',
      'If it looks right, press "Create the author — for real" and confirm.',
    ],
    done: `${f.name} appears in the Pipeline tab.`,
  }),
  [S.shopify]: (f) => ({
    title: 'Create the book product in Shopify',
    what: 'The product readers buy on leadershipbooks.com: the book plus the coach, for $29.95.',
    why: 'Buying it is what starts a reader\'s 10-day trial.',
    how: [
      'Open the Onboard tab → step 4.',
      'Check the price (29.95). SKU is optional; leave the weight blank for a paperback weight (0.95 lb). The product is made with the Print Books category, a short description, a weight and US origin — what Shopify needs to sell it outside the US.',
      'Product image (optional): either paste the picture\'s path on this computer (Shift + right-click it → "Copy as path"), or a link to it. It is uploaded full size, exactly as it is.',
      'Press "Preview (dry run)" — it shows the image\'s size, and refuses one Shopify would not take. Then "Create the Shopify bundle — for real".',
      'Made it by hand in Shopify instead? Paste its product id and variant id into the boxes and press Save.',
      'Product already there but no picture? Fill in one of the image boxes, then "Preview (dry run)" and "Add the image to the product — for real". Only the picture is added; nothing else on the product changes.',
    ],
    done: 'The product shows on the store, and its ids are saved.',
  }),
  [S.course360]: (f) => ({
    title: 'Make the private course in Course360',
    what: 'A private course: the 7 "Getting to know Book Coach AI" videos and one lesson that shows this author\'s coach. It is free, and only people the system lets in can see it.',
    why: 'It is how customers reach the coach and the "Get my activation code" button.',
    how: [
      copy('In GHL: Memberships → Courses → find the master course → ⋯ (three dots) → Duplicate. The master is', DEFAULT_COURSE_MASTER_TITLE),
      'Come back here and press "Preview (dry run)". It finds the copy by itself and lists what it will change. (Two copies, or none? It says so — then paste the course\'s link into "Course link".)',
      'If the preview looks right, press "Make the course — for real". It renames the course, puts this author\'s coach in the "BookCoach AI" lesson, makes the Free Offer (already Published) and saves the links — step ' + S.lessonUrl + ' fills itself.',
      'Last, by hand in GHL: open the course and check the intro videos play (no program can see videos), and add its picture — Memberships → Courses → the course → ⋮ → Edit → upload the image. (A picture set by a program shows broken, so the dashboard does not set one.)',
    ],
    done: 'Every check above is green: the course, its coach lesson, and a Free, Published Offer that gives it.',
  }),
  [S.lessonUrl]: (f) => ({
    title: 'Save the lesson\'s link',
    what: 'The web address of the lesson you made in step 5.',
    why: 'The welcome email sends customers to it.',
    how: [
      `Made the course with "Make the course" in step ${S.course360}? Then the link is already saved — nothing to do here.`,
      'Only for a course made by hand: in Course360, open the lesson as a preview and copy the address from your browser.',
      `Paste it into step ${S.lessonUrl} of the Onboard tab and press Save. (The "preview" part of the link is removed for you.)`,
    ],
    done: 'The link is saved and opens.',
  }),
  [S.zipify]: (f) => ({
    title: 'Make the sales page on Zipify',
    what: 'The page on leadershipbooks.com that sells the book + coach.',
    why: 'It is where readers buy. The Add to Cart button must add THIS author\'s product.',
    how: f.salesPage ? [
      'This author\'s sales page already exists — you only need to fix what is marked wrong above.',
    ] : [
      'Make this author\'s words first: under "Generate Landing Pages" below, press "Generate with Claude Code" (or "Copy the prompt" and paste it into a Claude Code chat). When it is done, press "Open the page".',
      'In Zipify, duplicate a live sales page (for example Freddy Davis\'s).',
      copy('Name the copy', f.zipifyName),
      copy('In its Publish Settings, set URL and Handle (the part after /pages/) to', f.zipifyHandle),
      copy('…and the Meta Title to', f.zipifyMetaTitle),
      'Paste the three boxes: on the page you opened, press each box\'s Copy button; in Zipify click the matching text box, press Ctrl+A, then Ctrl+V. Box 1 is the main image\'s text, box 2 the top text box, box 3 the long text after Add to Cart.',
      copy('Add to Cart: click the page\'s Product block (the one around the Add to Cart button) → its Product setting → choose this author\'s bundle', f.bundle),
      f.videoEmbed
        ? copy('The book\'s video: where it goes on the page, add a Custom HTML element and paste', f.videoEmbed)
        : 'Has the book a video? Paste its normal YouTube link into "Book video on YouTube" below and press Save — the code to paste appears above, ready to copy.',
      `Publish — and finish step ${S.grant} (the grant workflow) the same day, before anyone can buy. Then save the page's address in step ${S.salesUrl}.`,
    ],
    ignore: f.salesPage ? ['"Generate Landing Pages" — only needed to change the page\'s words.'] : [],
    done: 'The page opens, its Add to Cart is Zipify\'s product button set to this author\'s bundle, and it names no other author.',
  }),
  [S.collection]: (f) => ({
    title: 'Make the course collection product in Shopify (optional)',
    what: `A second product on leadershipbooks.com, "${f.collection}": the course and the book together, $97 to start, with its own picture. Optional — skip it for an author who has no course collection.`,
    why: 'It is what the collection part of the sales page sells.',
    how: [
      'Check the price (97.00). Change it if this collection sells for something else.',
      'Picture: paste its path on this computer (Shift + right-click it → "Copy as path"), or a link to it. It is uploaded full size, exactly as it is.',
      'Press "Preview (dry run)" — it shows the picture\'s size. Then "Create the collection product — for real".',
      'It is made with no inventory tracking and no shipping address at checkout — and with the Educational Services category and a short standard description, which Shopify needs before it will sell it outside the US.',
      f.collectionCartLink ? copy('Its Add to Cart link, for the collection button on the sales page', f.collectionCartLink) : 'Its Add to Cart link appears here once it is made.',
      'Under "Generate Landing Pages", make the collection text to paste on the sales page.',
      'This author has no collection? Press Sign off instead — the step turns done.',
      'Note: buying this product does not give the AI coach yet — that is planned separately (plan 02).',
    ],
    done: 'The product is on the store with its picture — or you signed off that this author has none.',
  }),
  [S.salesUrl]: (f) => ({
    title: 'Save the sales page\'s address',
    what: 'The web address of the Zipify page from step 7.',
    why: 'So the dashboard can check the page for you.',
    how: ['Open the published sales page, copy the address from your browser, paste it into step 9 and press Save.'],
    done: 'The address is saved.',
  }),
  [S.funnel]: (f) => ({
    title: 'Make the $59 sign-up page',
    what: `The page at ${f.funnelUrl} where a reader pays $59/month to keep the coach.`,
    why: 'The day 7, 9 and 10 emails send readers here. It must exist before the first trial reaches day 7.',
    // Two of these are NOT in the page editor: the path and the product belong to the funnel STEP.
    how: [
      'GHL → Sites → Funnels → open an existing coach-access funnel (e.g. Freddy Davis) → duplicate it, and open the copy.',
      'You are now on the funnel\'s own screen (its steps listed on the left) — not inside the page editor. Paths and products are set HERE.',
      copy('Path: click the order-form step, find its Path (it reads something like order-form-page-1234), edit it to', f.slug ? `${f.slug}-coach-access` : '<slug>-coach-access'),
      copy('Product: on the same step, open its Products tab → delete the old author\'s product → Add Product → pick', f.product),
      '…then pick its $59 monthly price, and Save.',
      'In the page editor the order form always says "Dynamic Item" with a made-up price — that is normal. The real product only shows on the published page.',
      `Text: press Edit on the step to open the page editor, click any text that names the old author, and change it to ${f.name}. Save.`,
      'Publish (top right in the editor). Then press Refresh in the dashboard — it checks the page sells THIS author\'s product.',
    ],
    done: 'The page opens and sells this author\'s product at $59.',
  }),
  [S.grant]: (f) => ({
    title: 'Make the GHL workflow that gives the course',
    what: 'A small automation in GHL: when someone gets this author\'s coach tag, they are given the course.',
    why: 'Without it, customers get access but never get the course — so no activation code.',
    how: [
      copy('GHL → Automation → Workflows → Create → start from scratch. Name it', f.workflowName),
      copy('Add the trigger "Contact Tag" → "Tag added" → choose the tag', f.tag),
      `Add the action "Grant Offer" (Memberships) → choose the "${f.courseName}" Offer.`,
      `Not in the list? Its Offer is still a Draft, or missing — press "Make the course" in step ${S.course360} again: it makes the Offer and publishes it.`,
      'Save, then switch it to Published (top right). Do this BEFORE the first order.',
      'Press Refresh, then sign off here that the trigger is the coach tag.',
    ],
    done: 'The workflow shows Published, and you have signed off the trigger.',
  }),
  [S.goLive]: (f) => ({
    title: 'Go live',
    what: 'Sends this author\'s details to the system that runs the coach, so it can answer.',
    why: 'Until this is done, texting and calling do not know this author, and the coach page answers only through its backup.',
    how: [
      'Open the Onboard tab → step 12.',
      'Press "Preview (dry run)", then "Go live — for real" and confirm.',
    ],
    done: 'Step 12 turns green.',
  }),
  [S.allChecks]: (f) => ({
    title: 'Everything checked',
    what: `Nothing to do here — this turns green by itself once steps 0 to 12 are all green (step ${S.collection}, the course collection, is optional and not counted).`,
    why: 'It is the "ready" light.',
    how: ['If it is not green, it says which steps are still open. Click those steps and follow their help.'],
    done: 'Steps 0-12 are all green.',
  }),
  [S.e2e]: (f) => ({
    title: 'Run the full test',
    what: 'A real $0 test order that goes through the whole customer path, start to finish, and checks every part.',
    why: 'It is the only way to be sure the buy → trial → email path really works for this author.',
    how: [
      'Open the Onboard tab → step 14.',
      'Type your test inbox (a real inbox you read) and press "Save the test inbox".',
      'Tick "Keep the test contact" if you want to check the emails by hand in step 15.',
      'Press "Preview (dry run)", then "Run the end-to-end test — for real". It can take up to 10 minutes.',
      'Separate from the test: the box "Give a real person free access" lower down is a gift, not a test. Type their email, press "Preview (dry run)", then "Give free access — for real". They get the normal free trial and the welcome email; their contact is kept.',
    ],
    done: 'It says "passed".',
  }),
  [S.handsOn]: (f) => ({
    title: 'Check it yourself',
    what: 'You look at what a real customer would see.',
    why: 'Reading an email and clicking a link is the one thing a script cannot honestly check.',
    how: [
      `In your test inbox: the welcome email arrived, and it names ${f.name}.`,
      'The "Welcome!" email from Leadership Books arrived — open its login link.',
      'The course opens and shows the coach. The coach answers.',
      'Press "Get my activation code" — you get a code.',
      'If all of that worked, sign off below.',
    ],
    done: 'You have signed it off.',
  }),
  [S.cleanUp]: (f) => ({
    title: 'Tidy up the test',
    what: 'Remove the test contact made by step 14.',
    why: 'Left in place, it keeps getting free access and looks like a real customer in every count.',
    how: [
      'If you did NOT tick "Keep the test contact", there is nothing to do — it cleaned itself up.',
      'If you did: GHL → Contacts → search "+verify-" → delete that contact. Then press Refresh.',
    ],
    done: 'No test contact holds this author\'s tag.',
  }),
};

/* ===================================================== problems → fixes === */

/** Where a page lives, for the checks that run on three different pages. */
const PAGE = {
  [S.coachPage]: (f) => ({ which: 'coach page', where: `GHL → Sites → Websites → the ${f.pageUrl} page` }),
  [S.funnel]: (f) => ({ which: '$59 sign-up page', where: `GHL → Sites → Funnels → the ${f.funnelUrl} page` }),
  [S.zipify]: (f) => ({ which: 'sales page', where: `Zipify → the ${f.salesPage || 'sales'} page` }),
};


const repaste = (f) => [
  'Press "Open the page form" (or: Onboard tab → this author → step 2). Check the answers — and that the "Get my activation code" toggle is on — then press "Save and build the page".',
  'Press "Copy the whole page".',
  `In GHL: Sites → Websites → open the ${f.pageUrl} page → open its Custom Code element.`,
  'Click inside it, press Ctrl+A (select all), then Ctrl+V (paste over it). Save, then Publish.',
  'Press Refresh in the dashboard.',
];

/**
 * Plain help for one live check. `level` says how much it matters:
 *   must      it is wrong or missing — fix it
 *   confirm   only a person can check it — look, then sign off
 *   optional  cosmetic — nothing breaks if you leave it
 * Returns null when there is nothing to say (the check is fine).
 */
export const CHECK_HELP = {
  'name, book, coach label and slug recorded': (f, r) => ({ level: r.status === 'WARN' ? 'optional' : undefined, say: `Some basic details are not saved: ${String(r.detail).replace(/^missing: /, '').replace(/ — counted as complete.*$/, '')}.${r.status === 'WARN' ? ' The step still counts as complete.' : ''}`, steps: ['Go to step 0, fill in the empty boxes, press Save — or, if this author does not need them, sign Inputs off.'] }),
  'inputs confirmed': () => ({ level: 'confirm', say: 'Something in the basic details is not saved. Only you know if this author needs it.', steps: ['Fill it in and press Save — or, if it is not needed, press Sign off.', 'Changed your mind later? Press Undo sign-off.'] }),
  'project, version and key recorded': () => ({ say: 'The Voiceflow ID numbers are not saved yet.', steps: ['Go to step 1 and follow its steps.'] }),
  'versionID is the 24-character id': () => ({ say: 'The Voiceflow version is saved as a word (like "main") instead of the long ID, so the coach cannot answer.', steps: ['In Voiceflow, select "Main" and copy the 24-character code from the address bar.', 'Paste it into step 1 and press Save.', 'Then do step 12 (Go live) again.'] }),
  'coach tag': () => ({ say: 'The author has not been created yet.', steps: ['Go to step 3 and press "Create the author".'] }),
  '$59 product': (f, r) => (r.status === 'TODO'
    ? { say: 'The $59 product does not exist yet.', steps: ['Go to step 3 and press "Create the author".'] }
    : { say: 'The $59 product saved for this author cannot be found in GHL.', steps: ['In GHL → Payments → Products, look for "' + f.product + '".', 'If it is gone, ask Claude to help recreate it — do not make one by hand.'] }),
  'hidden SERVICE': (f) => ({ say: 'The $59 product is set up the wrong way in GHL.', steps: [`GHL → Payments → Products → open "${f.product}".`, 'Set the type to Service, and turn OFF "Available in store". Save.'] }),
  'name convention': (f, r) => ({ level: 'optional', say: `The GHL product has an older-style name (${r.detail}).`, steps: [`Optional: in GHL → Payments → Products, rename it to "${f.product}". Nothing breaks if you leave it.`] }),
  '$59 monthly price': (f, r) => ({ say: r.detail === 'none' ? 'The $59 product has no $59-a-month price.' : 'The $59 product has more than one $59 price, so the sign-up page could use either.', steps: [`GHL → Payments → Products → "${f.product}" → Pricing: keep exactly ONE price, $59, recurring monthly. Delete any extra.`] }),
  'price recorded': (f, r) => ({ say: 'The $59 price is not saved in the author list yet.', steps: [copy('In PowerShell, inside the coach-router folder, run', String(r.fix || '').trim())] }),
  'bundle product': (f, r) => (r.status === 'TODO'
    ? { say: 'The Shopify product does not exist yet.', steps: ['Go to step 4 and follow its steps.'] }
    : { say: 'The Shopify product cannot be seen on the store.', steps: ['Shopify → Products → open the product.', 'Set Status to Active, and make sure "Online Store" is ticked under Sales channels. Save.', 'Press Refresh.'] }),
  'title convention': (f, r) => ({ level: 'optional', say: `The Shopify product's name is an older style (${r.detail}).`, steps: [`Optional: in Shopify → Products, rename it to "${String(r.fix || '').replace(/^expected "|".*$/g, '')}". Nothing breaks if you leave it.`] }),
  'one variant': () => ({ say: 'The Shopify product has more than one version (variant), so the cart link is unclear.', steps: ['Shopify → Products → open it → delete the extra variants, keep one. Save.'] }),
  'variant recorded': (f, r) => (r.status === 'TODO'
    ? { say: 'The Shopify variant id is not saved yet.', steps: ['Go to step 4, paste the variant id into its box, and press Save.', copy('The variant id is', String(r.detail).replace(/^variant is /, ''))] }
    : { say: 'The saved variant id does not match the Shopify product.', steps: ['Go to step 4 and save the right variant id.'] }),
  'available, ships': (f, r) => (/requires_shipping false/.test(r.detail || '') && !/available false/.test(r.detail || '')
    ? { say: 'The bundle is on sale, but Shopify no longer treats it as a physical product — so checkout will not ask for a shipping address, and the book cannot be posted. Someone unticked this by hand in Shopify.', steps: ['Shopify → Products → open this bundle → in the Shipping box, tick "This is a physical product". Save.', 'Press "Refresh this author" — this step turns green.'] }
    : { say: 'The Shopify product is not for sale, or is not marked as a physical product.', steps: ['Shopify → Products → open it: make it available, and tick "This is a physical product". Save.', 'Press "Refresh this author".'] }),
  'page details recorded': () => ({ say: 'No photo, author link or book buttons are saved yet.', steps: ['Go to step 2 and fill in the page form.'] }),
  'author photo': () => ({ level: 'optional', say: 'No photo — the coach page shows initials instead.', steps: ['Optional: add a photo in the page form (step 2), then build the page again.'] }),
  'author link': () => ({ level: 'optional', say: 'No link to the author\'s own website — the link is hidden on the coach page.', steps: ['Optional: add the author\'s OWN website in the page form (step 2), then build the page again.'] }),
  'book buttons': () => ({ level: 'optional', say: 'No "Buy the book" button on the coach page.', steps: ['Optional: add one in the page form (step 2), written as  Title|link-to-buy, then build the page again.'] }),
  'coach page': () => ({ say: 'There is no page slug yet, so there is no coach page address.', steps: ['Go to step 0 and fill in the Page slug.'] }),
  'page exists': (f) => ({ say: `The coach page ${f.pageUrl} does not exist yet.`, steps: ['Go to step 2 and follow its steps.'] }),
  'talks through the Worker': (f, r) => ({
    say: /another coach/.test(r.detail)
      ? 'This page is set up for a DIFFERENT coach — readers here would talk to the wrong author.'
      : 'This page talks to Voiceflow directly, and its secret key can be read by anyone who views the page.',
    steps: repaste(f),
  }),
  'page uses the old coach code': (f, r) => ({ level: 'optional', say: `The coach page still has the old coach code (${String(r.detail).split(',')[0].replace('COACH_CODE is ', '')}). It still works — the system remembers old codes.`, steps: ['Optional, when you have a minute:', ...repaste(f)] }),
  'showActivation: true': (f) => ({ say: 'The coach page has no "Get my activation code" button, so customers cannot switch on texting or calling.', steps: repaste(f) }),
  'author name': (f, r) => ({ say: `The coach page shows the wrong name (${r.detail}).`, steps: repaste(f) }),
  'no other author on the page': (f, r, step) => {
    const p = (PAGE[step] || PAGE[S.coachPage])(f);
    const who = String(r.detail).replace(/^visible: /, '');
    return { say: `The ${p.which} still shows another author: ${who}. It was copied from that author's page and not fully changed.`, steps: [`Open ${p.where} in its editor.`, `Find every "${who}" (Ctrl+F) and replace it with ${f.name} — or rewrite that part.`, 'Save, Publish, then press Refresh.'] };
  },
  'no other author in SEO / page data': (f, r, step) => ({
    level: 'optional',
    say: `Another author's name (${r.detail}) is hidden in the page's search-engine data. Readers do not see it; Google might.`,
    steps: step === S.funnel // the $59 funnel page
      ? ['Optional: in the funnel page’s editor, open the "SEO & AI search optimization" panel → Schema markup, and change the description that names the other author to this one (or switch the auto-generated schema off and on again).', 'Publish, then press Refresh.']
      : ['Optional: open the page\'s SEO / page settings and change the description to this author.'],
  }),
  // Step Course360, read through the Courses API (plans/03, 2026-10-13).
  'course made': () => ({ say: 'This author has no Course360 course yet.', steps: [`Go to step ${S.course360} and follow its steps: Duplicate the master course in GHL, then press "Make the course".`] }),
  'course exists': () => ({ say: 'The course saved for this author is not in Course360 any more — it was probably deleted.', steps: [`Duplicate the master course in GHL again, then step ${S.course360} → Preview → "Make the course". It saves the new course's link.`] }),
  'course title': (f) => ({ level: 'optional', say: 'The course\'s name is not the standard one.', steps: [`Step ${S.course360} → Preview → "Make the course" renames it to "${f.courseName}".`] }),
  "coach lesson opens this author's coach": (f, r) => ({ say: `The course's "BookCoach AI" lesson does not show this author's coach (${r.detail}). Readers would talk to the wrong coach, or to none.`, steps: [`Step ${S.course360} → Preview → "Make the course" puts the right coach in. (No "BookCoach AI" lesson at all? Duplicate the master course again.)`] }),
  'course matches the master': (f, r) => ({ level: 'optional', say: `The course's modules or intro lessons are not the same as the master course's (${r.detail}).`, steps: ['Open both courses in GHL and compare. An older course made by hand looks like this — it still works.'] }),
  'Offer is Free, Published and gives this course': (f, r) => ({ say: `The course's Offer is not right: ${r.detail}. A reader the grant workflow gives it to would not get the course.`, steps: [`Step ${S.course360} → Preview → "Make the course" links the Offer to the course and publishes it. (A paid Offer, or one that also gives another course, it refuses — change that in GHL → Memberships → Offers.)`] }),
  'course picture shows in GHL': (f, r) => (r.status === 'FAIL'
    ? { say: 'The course\'s picture shows as a broken image. It was set from outside the course\'s own screen, and GHL can only show a picture uploaded there.', steps: ['GHL → Memberships → Courses → this course → ⋮ → Edit.', 'Upload the picture in its image box (this replaces the broken one). Save, then press Refresh.'] }
    : { level: 'optional', say: 'The course has no picture yet, so it shows GHL\'s default.', steps: ['GHL → Memberships → Courses → this course → ⋮ → Edit → upload the picture in its image box. Save, then press Refresh.'] }),
  'course readable': () => ({ level: 'confirm', say: 'The dashboard cannot read Course360.', steps: ['GHL → Settings → Private Integrations → "Book Coach Automation" → add "View Courses" and "Edit Courses", then press Refresh.'] }),
  'lesson URL': (f, r) => (r.status === 'TODO'
    ? { say: 'The lesson link is not saved yet.', steps: ['Go to step 6 and follow its steps.'] }
    : { say: 'The saved lesson link does not open.', steps: ['In Course360, open the lesson again, copy its link, paste it into step 6 and press Save.'] }),
  'grant workflow published': (f, r) => ({
    TODO: { say: 'The GHL workflow that gives the course does not exist yet.', steps: ['Go to step 11 and follow its steps.'] },
    FAIL: { say: 'The GHL workflow exists but is NOT published, so it does nothing.', steps: [`GHL → Automation → Workflows → open "${f.workflowName}".`, 'Switch it to Published (top right). Save. Then press Refresh.'] },
    MANUAL: { level: 'confirm', say: 'The dashboard cannot read GHL workflows, so check by hand.', steps: [`GHL → Automation → Workflows: "${f.workflowName}" must exist and be Published.`] },
  })[r.status] || null,
  'exactly one grant workflow': () => ({ say: 'There are two or more workflows giving this author\'s course — they may clash.', steps: ['GHL → Automation → Workflows: keep ONE "Grant Course" workflow for this author, delete or unpublish the others.'] }),
  'triggers on this coach\'s tag': (f) => ({ level: 'confirm', say: 'The dashboard can see the workflow is published, but not what starts it — check that once by hand.', steps: [`GHL → Automation → Workflows → open "${f.workflowName}".`, copy('Its trigger must be "Contact Tag added" with the tag', f.tag), 'If it is, press Sign off.'] }),
  'funnel page': (f) => ({ say: `The $59 sign-up page ${f.funnelUrl} does not exist yet. The day 7, 9 and 10 emails link to it.`, steps: ['Go to step 10 and follow its steps.'] }),
  'sells THIS author\'s product': (f) => ({ say: 'The $59 page still sells ANOTHER author\'s subscription. A buyer would pay and get the wrong coach.', steps: [`GHL → Sites → Funnels → the ${f.funnelUrl} page → open the order form → Products.`, `Remove the old product. Add "${f.product}" with its $59 monthly price.`, 'Save, Publish, then press Refresh.'] }),
  '...at the $59 price': (f) => ({ say: 'The $59 page uses the wrong price.', steps: [`In the order form, choose the $59 monthly price of "${f.product}". Save, Publish, Refresh.`] }),
  // The page may well exist: until its address is saved (step 9) the dashboard has nothing to open.
  'Zipify page': () => ({ say: 'The dashboard does not know this author’s sales page yet — it can only check a page once its address is saved.', steps: [
    'Already built and published it? Go to step 9 (the next step), paste the page’s address (from your browser’s address bar) and press Save. Then press Refresh: step 7 is checked, and turns green when the page passes.',
    'Not built yet? Follow "How this step works" below.',
  ] }),
  'landing page': () => ({ say: 'The saved sales page does not open.', steps: ['Check the page is published in Zipify, copy its real address, and save it again in step 9.'] }),
  // Since 2026-10-12 the Add to Cart is Zipify's own Product block, set to this author's bundle.
  'Add to Cart is this author\'s product button': (f, r) => (r.status === 'WARN'
    ? { level: 'optional', say: 'The Add to Cart is still the older plain link button. It works — buyers get the right bundle — but the pages now use Zipify\'s product button.', steps: [
      'In Zipify, open the sales page.',
      copy('Add a Product block (or use the one on the page) → its Product setting → choose', f.bundle),
      'Delete the old plain ADD TO CART button. Save, publish, then press Refresh.',
    ] }
    : { say: 'Nothing on the sales page adds this author\'s bundle to the cart, so a buyer cannot buy it.', steps: [
      'In Zipify, open the sales page.',
      copy('Click the Product block around the Add to Cart → its Product setting → choose', f.bundle),
      'Make sure the block shows its own ADD TO CART (or BUY NOW) button. Save, publish, then press Refresh.',
    ] }),
  // Every Add to Cart on the page, not just "ours is there" — a clone can keep the source author's button.
  'no Add to Cart link points elsewhere': (f, r) => ({
    say: `An Add to Cart on the sales page adds the WRONG thing: ${r.detail}. A buyer who presses it pays for that, not ${/s$/i.test(f.name) ? `${f.name}’` : `${f.name}’s`} bundle.`,
    steps: [
      ...(/Zipify product block/.test(String(r.detail))
        ? [copy('A "Zipify product block" with its own buy button is still set to that other bundle (copied with the page). In Zipify, click that block → its Product setting → choose', f.bundle)]
        : [copy('A plain link button points at the other product. Delete it, or change its link to', f.cartLink)]),
      'Check every button that adds to the cart (there may be more than one — top, middle, bottom).',
      'Save and publish, then press Refresh.',
    ],
  }),
  // A product block with NO buy button of its own cannot send a buyer anywhere — a note, not a fault.
  'Zipify product block linked to another bundle': (f, r) => ({
    level: 'optional',
    say: `Not about payment. The Zipify "Product" block around the Add to Cart is still linked to ${String(r.detail).replace(/^.*→\s*/, '')} (copied with the page). Buyers are not affected: the button is a plain link to this author's bundle, and the block has no buy button of its own. Only Zipify's product data — and what search engines read — sees it.`,
    steps: [
      copy('Optional, to tidy it: in Zipify, click the Product block → its Product setting → choose', f.bundle),
      'Publish, then press Refresh.',
    ],
  }),
  'no template placeholders': (f, r) => ({ say: `The sales page still has leftover template words like ${r.detail}.`, steps: ['In Zipify, find each {{…}} word (Ctrl+F) and replace it with the real text. Publish, Refresh.'] }),
  'collection product': (f, r) => (r.status === 'MANUAL'
    ? { level: 'optional', say: 'No course collection product yet. It is optional.', steps: ['To make it: fill in the price and the picture below, then "Preview (dry run)" and "Create the collection product — for real".', 'This author has none? Press Sign off — the step turns done.'] }
    : { say: 'The saved collection product cannot be seen on the store.', steps: ['Shopify → Products → open it: set Status to Active, and tick "Online Store" under Sales channels. Save.', 'Press "Refresh this author".'] }),
  'collection image': () => ({ level: 'optional', say: 'The collection product has no picture.', steps: ['Fill in one of the picture boxes below, then "Preview (dry run)" and "Add the image to the product — for real".'] }),
  'collection variant recorded': (f, r) => ({ say: 'The collection product\'s variant id is not saved yet — it is its cart link.', steps: ['Paste it into the variant id box below and press Save.', copy('The variant id is', String(r.detail).replace(/^variant is /, ''))] }),
  'sales page URL recorded': () => ({ say: 'The sales page address is not saved yet.', steps: ['Go to step 9 and follow its steps.'] }),
  'pushed to KV': () => ({ say: 'This author has not gone live yet.', steps: ['Go to step 12 and press "Go live".'] }),
  'Worker holds the key': () => ({ say: 'The coach system does not have this author\'s Voiceflow key, so the coach cannot answer.', steps: ['Go to step 12 and press "Go live" again.', 'Still red afterwards? Ask Claude.'] }),
  'KV matches coaches.json': () => ({ say: 'The live system has older details than the author list.', steps: ['Go to step 12 and press "Go live" again.'] }),
  'steps 0-12 read green': (f, r) => ({ say: `Some earlier steps are still open (${String(r.detail).replace(/^still open: /, '')}).`, steps: ['Click each of those steps and follow its help.'] }),
  'verify-author': (f, r) => (r.status === 'TODO'
    ? { say: 'The full test has not been run yet.', steps: ['Go to step 14 and follow its steps.'] }
    : { say: 'The last full test FAILED.', steps: ['Go to step 14, run it again, and read the output — it says which part failed.', 'Fix that part, then run the test again.'] }),
  '$0 real order': () => ({ level: 'confirm', say: 'The test has not yet been run with a real $0 Shopify order.', steps: ['Go to step 14 and run the test — it places the $0 order for you.'] }),
  'welcome email, course invite, coach reply, activation code': (f) => ({ level: 'confirm', say: 'Only you can check what a customer sees.', steps: [`In your test inbox: the welcome email names ${f.name}; the "Welcome!" email from Leadership Books opens the course; the coach answers; "Get my activation code" gives a code.`, 'If all of that worked, press Sign off.'] }),
  'no test contacts left entitled': (f, r) => (r.status === 'TODO'
    ? { say: 'This can only be checked once the author exists (step 3).', steps: [] }
    : { say: 'A test contact from step 14 still has free access.', steps: ['GHL → Contacts → search "+verify-" → delete it. Then press Refresh.'] }),
};

/**
 * Help for one step: the step itself, and what is wrong with it right now.
 * `live` is the step as lib-pipeline derived it (rows, state), or null for a
 * draft author who does not exist yet.
 */
/** The checks that read a published page — the ones a just-published change can lag behind. */
export const LIVE_PAGE_CHECKS = new Set(['page exists', 'talks through the Worker', 'page uses the old coach code', 'showActivation: true', 'author name',
  'no other author on the page', 'funnel page', 'sells THIS author\'s product', '...at the $59 price', 'landing page',
  'Add to Cart is this author\'s product button', 'no Add to Cart link points elsewhere', 'no template placeholders']);

export function helpFor(stepId, values = {}, live = null) {
  const f = facts(values);
  const base = STEP_HELP[stepId] ? STEP_HELP[stepId](f) : null;
  if (!base) return null;
  const problems = [];
  for (const r of (live && live.rows) || []) {
    if (r.status === 'DONE' || (r.status === 'MANUAL' && r.signed)) continue;
    const make = CHECK_HELP[r.check];
    const h = make ? make(f, r, stepId) : null;
    if (h) problems.push({ check: r.check, status: r.status, level: h.level || (r.status === 'WARN' ? 'optional' : r.status === 'MANUAL' ? 'confirm' : 'must'), say: h.say, steps: h.steps || [] });
    // A check with no plain help still shows, so nothing wrong is ever hidden.
    else problems.push({ check: r.check, status: r.status, level: r.status === 'WARN' ? 'optional' : r.status === 'MANUAL' ? 'confirm' : 'must', say: `${r.check}: ${r.detail || r.status}`, steps: r.fix ? [r.fix] : [] });
  }
  const order = { must: 0, confirm: 1, optional: 2 };
  problems.sort((a, b) => order[a.level] - order[b.level]);
  // Two problems fixed by the very same steps (e.g. a coach page that both talks
  // to Voiceflow directly AND lacks the activation button) are one job: show one box.
  const merged = [];
  for (const p of problems) {
    const key = `${p.level}|${JSON.stringify(p.steps)}`;
    const same = p.steps.length && merged.find((m) => m.key === key);
    if (same) { same.say = `${same.say} Also: ${p.say.charAt(0).toLowerCase()}${p.say.slice(1)}`; same.checks.push(p.check); }
    else merged.push({ ...p, key, checks: [p.check] });
  }
  problems.length = 0;
  for (const { key, ...p } of merged) problems.push(p);
  const state = live ? live.state : null;
  const headline = !live ? 'Not started yet.'
    : state === 'DONE' && !problems.length ? 'Done — nothing to do here.'
      : state === 'DONE' ? 'Done. A few optional extras below — nothing breaks if you skip them.'
        : state === 'OPTIONAL' && !problems.some((p) => p.level === 'must') ? 'Optional — do it, or sign off that this author does not need it.'
        : state === 'BLOCKED' && !problems.some((p) => p.level === 'must') ? `Waiting — finish step ${(live.blockers || []).join(', ')} first.`
          : problems.some((p) => p.level === 'must') ? 'Something here needs fixing.'
            : problems.some((p) => p.level === 'confirm') ? 'Only you can finish this: check it, then sign off.'
              : 'Ready to do.';
  // The three steps read a LIVE page (coach page, Zipify, funnel). Right after a publish, GHL and
  // Zipify can still serve the old copy for a minute — so a red mark may just be early.
  // Only for a problem found by READING the page — not for "its address is not saved yet".
  const tip = PAGE[stepId] && problems.some((p) => p.level === 'must' && p.checks.some((c) => LIVE_PAGE_CHECKS.has(c)))
    ? 'Just published? GHL and Zipify can take a minute or two to show the change on the live page. Wait a minute, then press Refresh again before changing anything else.'
    : '';
  return { ...base, headline, problems, tip, ignore: base.ignore || [] };
}

/* ======================================================== health checks === */

export const HEALTH_HELP = {
  H1: () => ({ say: 'The system that runs the coach is reporting a problem.', steps: ['Read the problem listed on the card.', 'Ask Claude to look at it — paste the card\'s text.'] }),
  H2: () => ({ say: 'A paid order is more than 22 days old and its trial never started — the automatic 21-day timer did not fire for it.', steps: ['In Shopify, open the order named on the card.', 'Add the tag delivered-manual to the order, then More actions → Automate with Flow → Run workflow. That starts the trial now.', 'Tell Claude, so the timer can be checked.'] }),
  H3: () => ({ say: 'An order was tagged delivered-manual, but the Run workflow button was never pressed — the tag alone does nothing.', steps: ['In Shopify, open the order named on the card.', 'More actions → Automate with Flow → choose the manual-delivery workflow → Run workflow.'] }),
  H4: () => ({ say: 'A customer\'s 10-day trial has passed its end date but they still have access.', steps: ['Ask Claude to check the expiry sweep — paste the card\'s text.'] }),
  H5: () => ({ say: 'Someone has coach access with no trial and no subscription.', steps: ['In GHL, open the contact named on the card.', 'If they should NOT have access, remove the coach tag.', 'If it is on purpose (staff, a gift), keep it and tell Claude, so it is not flagged again.'] }),
  H6: () => ({ say: 'A contact\'s status and their access disagree — for example "trial" but no access, or "expired" but still has access.', steps: ['In GHL, open the contact named on the card and fix the coach tag or the Coach Status field, so they agree.'] }),
  H7: () => ({ say: 'A test contact from the full test still has free access.', steps: ['GHL → Contacts → search "+verify-" → delete it.'] }),
  H8: () => ({ say: 'The GHL workflow that sends every trial email is not published, so no customer gets the welcome or day 7/9/10 emails.', steps: ['GHL → Automation → Workflows → "Book Coach — Delivery → Trial Start" → switch it to Published.'] }),
  H9: () => ({ say: 'A paying subscriber does not have the coach tag yet, so they may not get their course.', steps: ['Wait 15 minutes and press Refresh — the system adds it by itself.', 'Still there an hour later? Ask Claude.'] }),
};

export function healthHelp(row) {
  if (!row || row.status === 'OK' || row.status === 'SKIP') return null;
  const make = HEALTH_HELP[row.id];
  return make ? make() : null;
}
