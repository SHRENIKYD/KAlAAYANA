// Feature flags: on/off switches the master account controls from the admin,
// kept in src/data/site.json under "features". A flag that is missing counts
// as its default. Shared by the Worker, the local demo and the build; the
// admin shows each flag's label and hint from here.
export const FEATURES = [
  {
    key: 'watermarkPhotos',
    label: 'Studio mark on photographs',
    hint: 'The faint logo in the corner of project, collectables and section photographs on the site.',
    default: true,
  },
  {
    key: 'watermarkAdmin',
    label: "Editor's name across the admin",
    hint: "The faint repeating line with the signed-in editor's name, email and date.",
    default: true,
  },
  {
    key: 'blockPhotoSaving',
    label: 'Block saving photographs',
    hint: 'No "Save image", long-press menu or dragging on photographs. Text and links are unaffected.',
    default: true,
  },
  {
    key: 'blankOnScreenshot',
    label: 'Blank the screen on screenshot keys',
    hint: 'On computers, the page goes blank when the screenshot keys are pressed (Print Screen, Win+Shift+S, Cmd+Shift+3/4/5). Phones and tablets cannot be detected.',
    default: true,
  },
  {
    key: 'loadingSkeletons',
    label: 'Loading skeletons',
    hint: 'Grey placeholder shapes while a page loads, in place of the text and photographs.',
    default: true,
  },
];

const known = new Map(FEATURES.map((f) => [f.key, f]));

/** Every flag's value for this site, defaults filled in. */
export function featuresOf(site) {
  const set = (site && site.features) || {};
  return Object.fromEntries(
    FEATURES.map((f) => [f.key, typeof set[f.key] === 'boolean' ? set[f.key] : f.default]),
  );
}

/** Problems with flags sent by the admin; empty when they can be saved. */
export function validateFeatures(flags) {
  if (!flags || typeof flags !== 'object' || Array.isArray(flags))
    return ['features must be an object'];
  const bad = [];
  for (const [key, value] of Object.entries(flags)) {
    if (!known.has(key)) bad.push(`Unknown feature flag ${key}`);
    else if (typeof value !== 'boolean') bad.push(`${known.get(key).label} must be on or off`);
  }
  return bad;
}

export const sameFeatures = (a, b) =>
  JSON.stringify(featuresOf({ features: a })) === JSON.stringify(featuresOf({ features: b }));

/** The flags as the admin lists them. */
export const featureList = () => FEATURES.map(({ key, label, hint }) => ({ key, label, hint }));
