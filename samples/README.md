# Samples

Output from a real run, committed so the system can be read without credentials or the source PDFs.

Nothing here is written by hand. `pnpm samples` regenerates all of it from whatever is currently in
the database.

| File          | What                                                                               |
| ------------- | ---------------------------------------------------------------------------------- |
| `export.json` | The full export for one document — facts, edges, and every refusal with its reason |
| `cases.json`  | The four assignment cases, each chosen by a query over system output               |
| `pages/*.png` | One page raster per document: the page carrying the most published facts           |

The export is scoped to a single document on purpose. A whole-corpus export runs to several
megabytes; one document has the identical shape and can actually be opened.

## Reading it

Start with `failures.assertions` in `export.json`. Each entry is a candidate the system refused,
with the reason code that stopped it — `quote_not_found` means the model wrote something that is not
on the page, and that one is the whole point of the design.

Then look at `edges`. `matchedFields` is what licenses a verdict: a `contradicts` requires time,
scope, unit, modality, and attribution all present there. An edge carrying `priorPass` is one where
a first pass said the two claims conflict and a reversed-burden second pass found the qualifier that
lets both stand.

The page rasters are exactly what the evidence viewer draws on. Multiply any assertion's
`evidence.bbox` by the page's recorded raster scale and you get the highlight in image pixels.

## A case may be empty

`cases.json` reports honestly when the current corpus produced no example of a case. That is the
intended behaviour, not a gap in the sample: the four are selected by query, and staging one would
be the demo-overfitting the implementation plan's risk register warns about.
