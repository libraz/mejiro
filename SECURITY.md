# Security policy

## Reporting a vulnerability

Report privately, not through the public issue tracker:

- **Preferred:** GitHub's private vulnerability reporting, from the repository's
  [Security tab](https://github.com/libraz/mejiro/security/advisories/new).
- **Alternative:** email `libraz@libraz.net`.

Include the document that triggers it, what happened, the affected version and
package, and a minimal reproduction if you have one. Expect an acknowledgement
within a few days.

## Supported versions

Pre-1.0. Fixes land on the latest release only; older versions are not patched.

## What is in scope

mejiro lays out text it did not write and opens EPUB files it did not produce,
so the parsing path is the interesting surface. In scope:

- An EPUB that escapes the extraction directory through a crafted entry path, or
  that expands to an unreasonable size from a small archive.
- Markup inside a document reaching the DOM as script or as an active URL
  through the reader and editor components, rather than as text.
- Text, ruby markup or an exclusion region that causes a hang or unbounded
  memory growth in the layout engine.
- External entity resolution or entity expansion while parsing a document's XML.
- Any network access made while opening a local document.

## What is not in scope

- Wrong typesetting. A line broken in the wrong place, misapplied kinsoku or
  misaligned ruby is a correctness bug; report it as a normal issue.
- Documented limits behaving as documented — document-size and iteration
  ceilings exist so a hostile file cannot exhaust the host. A ceiling that can be
  bypassed is in scope.
- Content an application deliberately passed through after disabling
  sanitisation.
- Findings that require an attacker to already control the process embedding the
  engine.
