// Editor-friendly prompt library — copied 1:1 from Flimify Studio's
// SUGGESTIONS array (kept in sync). Powers the empty-state suggestion chips and
// ghost autocomplete. Each entry: [label, prompt, category].

export type Suggestion = { label: string; prompt: string; cat: string };

export const SUGGESTIONS: [string, string, string][] = [
  // Intros / outros / titles
  ['3s logo intro',     'Make a 3 second logo intro that says NOVA in white on a deep blue gradient', 'Intros & Titles'],
  ['Title card',        'Make a chapter title card that fades in, holds for 2 seconds, then fades out', 'Intros & Titles'],
  ['Kinetic intro',     'Create a kinetic typography intro for my podcast with the word PODCAST animating in', 'Intros & Titles'],
  ['End card',          'Generate a YouTube end card with a subscribe button and a next-video tile', 'Intros & Titles'],
  ['Outro screen',      'Create a clean outro screen with "Thanks for watching" and a subscribe prompt', 'Intros & Titles'],

  // Captions / text emphasis (huge for short-form)
  ['Caption pop',       'Make a TikTok-style caption that pops in word by word with a slight bounce', 'Captions & Text'],
  ['Word-by-word',      'Generate centered word-by-word captions with a punchy spring animation, white text with black stroke', 'Captions & Text'],
  ['Type-on text',      'Make text typing on character by character with a blinking cursor', 'Captions & Text'],
  ['Highlight marker',  'Generate a yellow highlight marker drawing under text from left to right', 'Captions & Text'],
  ['Scribble underline','Make a hand-drawn scribble underline animating across the bottom of a word', 'Captions & Text'],
  ['Shake emphasis',    'Create a quick shake-and-zoom emphasis on a centered word for 0.6 seconds', 'Captions & Text'],
  ['Quote card',        'Make a centered quote card with bold serif typography on a soft cream background, fade in', 'Captions & Text'],

  // Lower thirds / labels
  ['Lower third',       'Create a sleek animated lower third with a name and title field', 'Lower Thirds'],
  ['Name tag',          'Generate a minimal name tag with avatar circle and role text, sliding in from the left', 'Lower Thirds'],
  ['Tag chip',          'Make a small rounded tag chip popping in with subtle bounce, like a hashtag label', 'Lower Thirds'],

  // Social UI mocks
  ['iMessage bubble',   'Create an iPhone iMessage bubble with text typing in then sending, with read receipt', 'Social UI'],
  ['DM notification',   'Make an Instagram DM-style notification banner sliding in from the top with sender + preview', 'Social UI'],
  ['Like burst',        'Generate a heart-like burst animation popping out from screen center with little hearts flying out', 'Social UI'],
  ['Subscribe pop',     'Make a smooth animated subscribe button popping in over a transparent background', 'Social UI'],
  ['Subscribe + bell',  'Create a YouTube subscribe-then-bell click sequence with cursor and ripple effect', 'Social UI'],
  ['Live indicator',    'Generate a red LIVE dot pulsing with the word LIVE next to it, top corner badge', 'Social UI'],
  ['Hashtag pop',       'Make an animated hashtag chip popping in with a soft glow', 'Social UI'],
  ['Comment overlay',   'Create a TikTok-style comment overlay sliding up from the bottom with avatar and text', 'Social UI'],

  // Counters / data
  ['Stat counter',      'Create a stat counter that animates from 0 to 1000 with comma separators', 'Counters'],
  ['Money counter',     'Generate a money counter ticking from $0 to $10,000 with bold green typography', 'Counters'],
  ['Day counter',       'Make a "Day 1 → Day 30" transition card with bold typography flipping over', 'Counters'],
  ['Score counter',     'Create a 0 to 100 percent score counter with smooth ease-out', 'Counters'],
  ['Star rating',       'Generate a star rating animation that fills from 0 to 5 stars one by one', 'Counters'],
  ['Vote bar',          'Make a poll-style vote bar filling 0 to 75 percent with the percentage label', 'Counters'],
  ['Step indicator',    'Generate a 3-step progress indicator showing step 1 of 3, 2 of 3, 3 of 3', 'Counters'],
  ['Progress ring',     'Make a circular progress ring animating from 0 to 100 percent with center percentage label', 'Counters'],
  ['Loading bar',       'Create a horizontal loading bar filling from 0 to 100% with smooth gradient', 'Counters'],
  ['5→1 countdown',     'Generate a clean 5 to 1 countdown with big white numerals on a dark background', 'Counters'],

  // Comparisons / explainers
  ['Versus card',       'Create a versus comparison card with two options side by side, bold labels and a center "VS"', 'Explainers'],
  ['Pros vs cons',      'Generate a 2-column pros vs cons list with green checkmarks on the left and red X on the right', 'Explainers'],
  ['Definition card',   'Make a dictionary-style definition card with the word, phonetic spelling, and meaning, sliding in', 'Explainers'],
  ['Question card',     'Generate a bold question card asking the question with a clean gradient background', 'Explainers'],
  ['Bullet list',       'Make an animated 3-point bullet list that reveals each item with a check mark', 'Explainers'],
  ['Tip card',          'Create a "PRO TIP" card with a lightbulb icon and a single-line tip text', 'Explainers'],
  ['Pop quiz',          'Generate a "POP QUIZ" question card with 4 lettered answer options A B C D', 'Explainers'],

  // Banners / breaking
  ['News ticker',       'Make a bottom news ticker scrolling text right to left with a colored prefix label', 'Banners'],
  ['Breaking banner',   'Create a "BREAKING NEWS" red banner sliding in from the bottom with a headline', 'Banners'],
  ['CTA banner',        'Generate a sleek animated banner that says LIKE AND SUBSCRIBE with a soft glow', 'Banners'],
  ['Watermark',         'Make a subtle bottom-right watermark with a channel name fading in and looping gently', 'Banners'],

  // Callouts / pointers
  ['Arrow callout',     'Generate an animated arrow that points at a UI element with a slight bounce loop', 'Callouts'],
  ['Circle highlight',  'Make an animated circle drawing around an object to highlight it', 'Callouts'],
  ['Spotlight',         'Create a soft spotlight sweeping across the frame from left to right', 'Callouts'],
  ['Stamp APPROVED',    'Generate a red rubber-stamp APPROVED slamming down at an angle with shake', 'Callouts'],

  // Transitions
  ['Glitch transition', 'Create a 1 second glitch transition I can place between two clips', 'Transitions'],
  ['Swipe transition',  'Make a clean horizontal swipe transition between two clips', 'Transitions'],
  ['Split reveal',      'Create a vertical split-screen reveal transition', 'Transitions'],
  ['Match cut zoom',    'Generate a smooth match-cut transition zooming into a circle and out the other side', 'Transitions'],
  ['Light leak',        'Create a warm orange light leak flash transition, half a second', 'Transitions'],
  ['Diagonal wipe',     'Make a clean diagonal wipe transition with a thin accent line at the edge', 'Transitions'],

  // Overlays / textures / loops
  ['Film grain',        'Make a 5 second film grain overlay loop on a transparent background', 'Overlays'],
  ['Particles bg',      'Generate a slow floating particles background loop, dark and minimal', 'Overlays'],
  ['Bokeh loop',        'Create a slow soft-bokeh circles background loop in warm tones', 'Overlays'],
  ['Confetti burst',    'Generate a celebration confetti burst from the bottom rising up and fading', 'Overlays'],
  ['Rain overlay',      'Make a subtle rain particle overlay loop on transparent background', 'Overlays'],
  ['Snow overlay',      'Generate a gentle falling snow loop on transparent background', 'Overlays'],

  // Frames / decorative
  ['Toast popup',       'Create an iOS-style notification toast that slides down then fades', 'Frames'],
  ['Polaroid frame',    'Make a polaroid photo frame falling into view with a slight rotation and shadow', 'Frames'],
  ['Price reveal',      'Generate a price tag reveal animation where the price flips into view with depth', 'Frames'],
  ['Bookmark fold',     'Create an animated corner bookmark fold revealing with a soft shadow', 'Frames'],

  // ─── Trend-pack hooks (use the named style library packs) ───
  ['Brat title',        'Make a Charli XCX brat-style title — a single lowercase word in heavy black Arial on lime green, kerning closes in tight, holds for 30 frames', 'Trend Packs'],
  ['Coquette intro',    'Create a coquette pink intro — italic serif title with a few sparkles and a soft pink glow, slow blur-in', 'Trend Packs'],
  ['Y2K chrome title',  'Generate a Y2K chrome metallic gradient title for one word with a perspective grid floor and magenta glow', 'Trend Packs'],
  ['Mocha podcast intro','Make a Pantone-2025 mocha podcast intro with italic serif episode title and a soft warm light leak', 'Trend Packs'],
  ['Vaporwave sunset',  'Create a vaporwave sunset card with magenta-purple-teal gradient mesh and a synthwave grid floor', 'Trend Packs'],
  ['Dark academia card','Generate a dark academia title card with oxblood and cream, italic serif, candle-warm vignette', 'Trend Packs'],
  ['Sage wellness intro','Make a sage matcha wellness intro — slow fade, sage green palette, italic title, no effects', 'Trend Packs'],
  ['Editorial brutalist','Create an editorial brutalist title — massive uppercase headline in pure black-and-white with one red accent stripe', 'Trend Packs'],
  ['Glitch hype',       'Make a one-burst RGB-split glitch reveal on a hero word — 8 frames of chaos then hold clean', 'Trend Packs'],
  ['Reels gradient',    'Create an Instagram-style gradient mesh intro card with soft pastels and a blurred title fade-in', 'Trend Packs'],

  // ─── Hooks / openers (short-form opening lines) ───
  ['Hook: wait...',     'Make a 3-second hook intro that says "Wait — you have to see this" with a quick zoom-punch on the word "this"', 'Hooks'],
  ['POV caption',       'Make a TikTok "POV: you just discovered..." caption with word-by-word pop and a slight stroke shake', 'Hooks'],
  ['When you...',       'Generate a "When you finally finish editing" relatable caption in white-on-dark TikTok kinetic style', 'Hooks'],
  ['Me trying to...',   'Create a "Me trying to be productive at 3am" caption with word-pop and a slight rotation per word', 'Hooks'],
  ['Nobody talks about','Generate a "Nobody talks about this" hook line in heavy white-on-dark with kerning-in entrance', 'Hooks'],
  ['Story time',        'Make a "Story time" title card with a vintage-page texture and italic serif "story time" lowercase', 'Hooks'],
  ['Plot twist',        'Create a "PLOT TWIST" reveal — kerning-in entrance, hold, then a quick zoom-punch', 'Hooks'],
  ['Real talk',         'Generate a "Real talk." caption in clean editorial serif with a thick accent bar to the left', 'Hooks'],
  ['Watch this →',      'Make a "WATCH THIS" sticker callout with an arrow pointing right, slight rotation, stamp-slam landing', 'Hooks'],
  ['Hook: I bet you',   'Create an "I bet you didn\'t know..." hook caption with word-pop reveal', 'Hooks'],

  // ─── Quote / pull-quote variants ───
  ['Quote pull',        'Make a pulled-quote card with a thick orange accent bar and italic serif quote text, slow blur-in, hold', 'Quotes'],
  ['Quote + name',      'Generate a quote card with the quoted text and the speaker name beneath in muted caption case', 'Quotes'],
  ['Big quote',         'Create a full-frame editorial quote in serif italic with a small attribution line beneath, mocha palette', 'Quotes'],
  ['Author tagline',    'Make an author tagline card — italic editorial pull-quote sitting bottom-left over a dark vignette', 'Quotes'],

  // ─── Stat-slam variants ───
  ['Big stat slam',     'Create a stat slam — tiny kicker label above, then a big number counter from 0 ticking up, hold for 30 frames', 'Stats'],
  ['% growth',          'Make a percentage growth callout with a green up-arrow and the number animating from 0 to 43 percent', 'Stats'],
  ['Million reveal',    'Generate a "1,000,000+" subscribers reveal with the counter ticking up to 1 million and a tiny crown above', 'Stats'],
  ['Revenue tick',      'Create a revenue counter ticking from $0 to $124,500 with a tiny "this month" caption beneath', 'Stats'],
  ['Time saved',        'Make a "saved 14 hours" stat card with hour-glass icon and a count-up of hours', 'Stats'],
  ['Sales today',       'Generate a "Sales today" stat tile with a number counting up and a soft green up-trend line', 'Stats'],

  // ─── Before / after / comparison ───
  ['Before / After',    'Generate a clean horizontal split-screen "Before" vs "After" card with labels in safe zones', 'Before/After'],
  ['Day 1 vs Day 30',   'Make a Day 1 vs Day 30 transformation card — faded left, punchy right, accent line down the middle', 'Before/After'],
  ['Then vs now',       'Create a "Then vs Now" two-panel card with vintage filter left and clean right', 'Before/After'],
  ['What I expected',   'Generate a "What I expected vs what happened" two-panel card with playful pop labels', 'Before/After'],
  ['Cheap vs premium',  'Make a "Cheap vs Premium" comparison card with the premium side glowing warmer', 'Before/After'],

  // ─── Lists / step-by-step ───
  ['3 reasons why',     'Generate a numbered "3 reasons why" list reveal — items stagger in with thin numeric prefixes 01 02 03', 'Lists & Steps'],
  ['5 tips list',       'Make a "5 quick tips" list card — five items pop in one by one with check marks', 'Lists & Steps'],
  ['Steps 1 to 3',      'Create a "Step 1 of 3" → "Step 2 of 3" → "Step 3 of 3" chapter sequence with a thin progress bar at top', 'Lists & Steps'],
  ['How it works',      'Generate a "How it works" 3-step numbered explainer — each step has a tiny icon and a one-line caption', 'Lists & Steps'],
  ['Recipe steps',      'Make a recipe step card "Step 2: whisk eggs" with step number, instruction, and a small kitchen-warm palette', 'Lists & Steps'],
  ['Checklist done',    'Create a 4-item checklist where each item animates from unchecked to checked with a green tick', 'Lists & Steps'],
  ['Section break',     'Generate a brief full-frame section break card with a single word title in massive caps, hard cut entry', 'Lists & Steps'],
  ['Chapter divider',   'Make a chapter divider card with a Roman numeral and a chapter name, full-frame, crossfades', 'Lists & Steps'],

  // ─── Lower thirds / name introductions ───
  ['Bottom-left LT',    'Generate a sleek bottom-left lower third with name, role, and a thin accent stripe on the left', 'Lower Thirds'],
  ['Centered intro',    'Make a centered name introduction card — big name, smaller role beneath, slide-up entrance', 'Lower Thirds'],
  ['News anchor LT',    'Create a broadcast-news style lower third with name in white on a colored bar across the bottom', 'Lower Thirds'],
  ['Podcast guest',     'Generate a podcast guest intro card with name, role, and company in editorial serif, fades in', 'Lower Thirds'],
  ['Sponsored by',      'Make a "Sponsored by" reveal with logo placeholder, subtle accent line, top-right corner', 'Lower Thirds'],

  // ─── Tutorial / tech / dev ───
  ['Keyboard shortcut', 'Generate a keyboard shortcut overlay showing Cmd+Shift+T in nice rounded keycaps, popping in', 'Tutorial & Tech'],
  ['Terminal command',  'Make a terminal command card with the command in monospace on a dark window-chrome panel', 'Tutorial & Tech'],
  ['Code snippet',      'Create a syntax-highlighted code snippet card popping in with a soft glow underneath', 'Tutorial & Tech'],
  ['File tree',         'Generate an animated file-tree reveal — folders open in sequence, monospace, indented hierarchy', 'Tutorial & Tech'],
  ['Pull request',      'Make a GitHub-style pull request card with title, +200 -45, and a green merged badge', 'Tutorial & Tech'],
  ['Error message',     'Create a red error toast popup that slides in from the top with a brief stack-trace style line', 'Tutorial & Tech'],
  ['Loading dots',      'Generate a three-dot loading typing-indicator — pulses in sequence, bottom-left bubble', 'Tutorial & Tech'],

  // ─── Music / lyric / beat ───
  ['Karaoke line',      'Create a karaoke caption with each word highlighted yellow as it should be sung, white text on black', 'Music & Lyrics'],
  ['Lyric drop',        'Make a single lyric line dropping into the frame center, bold sans, with a subtle bass-thump scale', 'Music & Lyrics'],
  ['Beat hit pop',      'Generate a single word that pops on each beat hit — 4 quick pulses synced to a 120 BPM pulse', 'Music & Lyrics'],
  ['Drop incoming',     'Create a "DROP INCOMING" countdown — 3 2 1 then a flash and a single word reveal', 'Music & Lyrics'],
  ['Now playing',       'Generate a "Now Playing" music card with track title, artist, and a thin progress bar at the bottom', 'Music & Lyrics'],
  ['Sound wave bars',   'Make animated sound-wave bars equalizing in the bottom corner — 5 bars bouncing', 'Music & Lyrics'],

  // ─── Reaction / meme overlays ───
  ['Mind blown',        'Generate a mind-blown reaction overlay with explosion lines radiating from screen center', 'Reactions & Memes'],
  ['Fire emoji burst',  'Make a fire-emoji particle burst from the bottom — 6-8 emoji rising and fading', 'Reactions & Memes'],
  ['100 emoji slam',    'Create the 100 emoji slamming into the frame center with a quick shake', 'Reactions & Memes'],
  ['Heart eyes',        'Generate a heart-eyes emoji popping in with little heart particles rising around it', 'Reactions & Memes'],
  ['Skull emoji',       'Make a skull emoji wobbling in a corner — "this is so bad" reaction loop', 'Reactions & Memes'],
  ['Side eye',          'Create a side-eye emoji peeking in with shifty motion, hold, then pop out', 'Reactions & Memes'],
  ['Crying laugh loop', 'Generate a looping crying-laughing emoji bouncing in the bottom-right corner', 'Reactions & Memes'],
  ['Eyes peek',         'Make the eyes emoji peeking in from the bottom edge of the frame, then retreating', 'Reactions & Memes'],
  ['Sparkles around',   'Create sparkles popping around a single word — magical emphasis, soft glow', 'Reactions & Memes'],

  // ─── Data / charts ───
  ['Bar chart',         'Make a 4-bar bar chart filling up one bar at a time with values labeled above each bar', 'Charts'],
  ['Pie chart',         'Generate a pie chart filling in from 0 to 100 percent in segments, each segment labeled', 'Charts'],
  ['Line graph',        'Create a line graph drawing in from left to right with a single trend line and axis labels', 'Charts'],
  ['Donut metric',      'Make a donut chart with the central percentage counting up to 78% and a small label below', 'Charts'],
  ['Trend up arrow',    'Generate an up-trend arrow rising with the percentage label tracking alongside it', 'Charts'],
  ['Bar race tiny',     'Create a tiny 3-bar bar-race animation where bars reorder as values change', 'Charts'],

  // ─── Sports / scoreline ───
  ['Scoreline card',    'Make an ESPN-style scoreline card with two team names and a colon score, top-of-screen badge', 'Sports'],
  ['Player stat card',  'Generate a sports player card with avatar circle, name, and 3 stat lines in a dark-blue panel', 'Sports'],
  ['Match progress',    'Create a match progress bar showing 45:00 of a 90-min game with a halftime marker', 'Sports'],
  ['Goal flash',        'Make a "GOAL!" full-frame flash with the word slamming in shaking, on a team-color background', 'Sports'],

  // ─── Food / recipe / lifestyle ───
  ['Ingredient list',   'Make a recipe ingredient list — items stagger in with quantities, kitchen-warm palette', 'Food & Lifestyle'],
  ['Recipe timer',      'Generate a recipe timer counting down from 10:00 with a thin ring filling around it', 'Food & Lifestyle'],
  ['Calorie count',     'Create a calorie count chip in the corner — "320 kcal" with a tiny flame icon', 'Food & Lifestyle'],

  // ─── Travel / location ───
  ['Map pin drop',      'Make a map pin drop animation — pin falls into place with a small ripple under it', 'Travel'],
  ['Location title',    'Generate a location title card "Tokyo, Japan" in editorial serif with a thin accent line', 'Travel'],
  ['GPS trail',         'Create a GPS path drawing across a stylized map, dotted line from start to end pin', 'Travel'],
  ['Sunset overlay',    'Make a warm sunset color gradient sweeping across the frame from top to bottom', 'Travel'],
  ['Date stamp',        'Generate a film-stamp date card in the corner — "MAY 13, 2026" in mono, slight grain', 'Travel'],

  // ─── Word emphasis / text effects ───
  ['Word swap',         'Create a word-swap animation where the same position cycles through 3 words — fast pop swap', 'Word Effects'],
  ['Strikethrough word','Generate a word getting struck through with a line, then a replacement word fading in', 'Word Effects'],
  ['Highlighted word',  'Make a sentence where one key word gets a yellow highlight bar sliding in behind it', 'Word Effects'],
  ['Censor bar',        'Create an animated black censor bar sliding across a word with a tiny "BLEEP" caption above', 'Word Effects'],
  ['Spinning word',     'Generate a single word with each letter spinning into place one by one', 'Word Effects'],
  ['Falling letters',   'Make letters of a word falling down into place one at a time with a settle bounce', 'Word Effects'],
  ['Typewriter card',   'Create a typewriter typing-in card with a blinking caret and soft mono font', 'Word Effects'],
  ['Sparkle title',     'Generate a title with sparkles pinging around each letter for half a second', 'Word Effects'],
  ['Glitch word',       'Make a brief RGB-glitch on a single word — 6 frames of chaos, then hold clean', 'Word Effects'],

  // ─── CTAs / engagement asks ───
  ['Subscribe arrow',   'Create a subscribe arrow pointing to the subscribe button with a slight bounce loop', 'CTAs'],
  ['Tap to follow',     'Generate a "Tap to follow" overlay with a tapping finger animation in the corner', 'CTAs'],
  ['Share callout',     'Make a "Share this" callout with a paper-plane icon and arrow pointing to the share button', 'CTAs'],
  ['Save for later',    'Create a "Save this for later" bookmark icon with a subtle pulse in the corner', 'CTAs'],
  ['Drop a comment',    'Generate a "Drop a comment 👇" prompt with a small arrow pointing down', 'CTAs'],
  ['Smash that like',   'Make a "Smash that like" reminder with the like icon filling red as it animates', 'CTAs'],
  ['Notification bell', 'Create a bell icon ringing animation — slight rotation each side then settle', 'CTAs'],
  ['Coming up next',    'Generate a "Coming up next" preview strip in the bottom corner with a thumbnail placeholder', 'CTAs'],
  ['Up next tile',      'Make an end-screen "Up Next" tile with thumbnail + title that pops in and holds', 'CTAs'],

  // ─── Notifications / device chrome ───
  ['Sticky note',       'Generate a yellow sticky note slamming down with a slight wobble, handwritten-style text inside', 'Device & Notifications'],
  ['Speech bubble',     'Create a comic-style speech bubble popping in with a tail pointing left, text fades in', 'Device & Notifications'],
  ['Thought bubble',    'Make a thought bubble rising up — cloud shape with three trailing dots, text inside', 'Device & Notifications'],
  ['Tape sticker',      'Generate a piece-of-tape sticker landing on the frame at an angle, slight wobble', 'Device & Notifications'],
  ['Camera flash',      'Create a quick camera-flash effect — full-frame white flash, 4 frames, then snap back', 'Device & Notifications'],
  ['Recording dot',     'Make a red recording dot pulsing with "REC" label in the top corner', 'Device & Notifications'],
  ['Battery low',       'Generate a battery-low warning chip with the battery icon ticking down red', 'Device & Notifications'],
  ['Wifi off',          'Create a wifi-disconnected popup with the icon X-ed out and "No connection" caption', 'Device & Notifications'],
];

// Curated default view — the broadly-useful picks, looked up by label.
export const POPULAR_LABELS = [
    'Caption pop',        // short-form captions — #1 use
    'Word-by-word',
    'Lower third',        // interviews / talking-head name cards
    '3s logo intro',
    'Title card',
    'End card',
    'Subscribe pop',
    'Highlight marker',
    'Stat counter',
    'Quote card',
    'iMessage bubble',
    'Versus card',
];

const byLabel: Record<string, Suggestion> = {};
SUGGESTIONS.forEach(([label, prompt, cat]) => { byLabel[label] = { label, prompt, cat }; });

export const POPULAR: Suggestion[] = POPULAR_LABELS.map((l) => byLabel[l]).filter(Boolean);

/** Distinct categories in first-appearance order, with "Popular" prepended. */
export const CATEGORIES: string[] = (() => {
  const seen: string[] = [];
  for (const [, , cat] of SUGGESTIONS) if (!seen.includes(cat)) seen.push(cat);
  return ['Popular', ...seen];
})();

export const ALL: Suggestion[] = SUGGESTIONS.map(([label, prompt, cat]) => ({ label, prompt, cat }));

/** Ghost-autocomplete: the first suggestion prompt that begins with `text`
 *  (instant, client-side — no model call). Returns the full prompt, or null. */
export function ghostFor(text: string): string | null {
  const t = text.trimStart();
  if (t.length < 3) return null;
  const lc = t.toLowerCase();
  for (const [, prompt] of SUGGESTIONS) {
    if (prompt.toLowerCase().startsWith(lc) && prompt.length > t.length) return prompt;
  }
  return null;
}

/** Items for a category (search overrides category and matches across all). */
export function chipsFor(cat: string, query: string): Suggestion[] {
  const q = query.trim().toLowerCase();
  if (q) return ALL.filter((s) => s.label.toLowerCase().includes(q) || s.prompt.toLowerCase().includes(q));
  if (cat === 'Popular') return POPULAR;
  return ALL.filter((s) => s.cat === cat);
}
