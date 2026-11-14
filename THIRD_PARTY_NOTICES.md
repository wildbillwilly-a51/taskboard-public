# Third-Party Notices

Taskboard includes the following third-party software. These notices are
provided for attribution and license compliance.

## FullCalendar 6.1.21

Packages: `@fullcalendar/core`, `@fullcalendar/daygrid`,
`@fullcalendar/interaction`, `@fullcalendar/react`, and
`@fullcalendar/timegrid`.

MIT License

Copyright (c) 2021 Adam Shaw

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Preact 10.12.1

Preact is a runtime dependency of FullCalendar.

The MIT License (MIT)

Copyright (c) 2015-present Jason Miller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## BlockNote 0.56.0

Packages: `@blocknote/core`, `@blocknote/react`, and `@blocknote/ariakit`
(the Notes editor).

Mozilla Public License 2.0 (MPL-2.0). Taskboard uses these packages
unmodified. Their source code is available at
https://github.com/TypeCellOS/BlockNote (tag `v0.56.0`), and the license text
at https://mozilla.org/MPL/2.0/. The GPL/commercial `@blocknote/xl-*`
packages are not used.

BlockNote brings in further MIT-licensed libraries that are bundled with the
editor, including Ariakit (`@ariakit/react`), Tiptap (`@tiptap/*`), and
ProseMirror (`prosemirror-*`). Their license notices are included in their
packages in `node_modules`.

## Calendar and notifications

[ical.js 2.2.1](https://www.npmjs.com/package/ical.js/v/2.2.1) and
[web-push 4.0.0](https://www.npmjs.com/package/web-push/v/4.0.0) are used
unmodified under the [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/).
The linked npm versions contain their source and license notices.

## Diagrams and HTML sanitization

Mermaid and Khroma are MIT-licensed. ELK.js is available under the Eclipse
Public License 2.0 or GPL-3.0-or-later. DOMPurify is available under Apache-2.0
or MPL-2.0. See the source and notices for the versions pinned in
`package-lock.json`. [Mermaid](https://github.com/mermaid-js/mermaid) ·
[Khroma](https://github.com/fabiospampinato/khroma) ·
[ELK.js](https://github.com/kieler/elkjs) ·
[DOMPurify](https://github.com/cure53/DOMPurify)

## Image processing

The optional native Sharp packages come with platform-specific licenses.
Sharp is Apache-2.0. Its libvips binaries carry LGPL-3.0-or-later terms.
[Sharp license notices and sources](https://github.com/lovell/sharp)

## Fonts

The build fetches Public Sans and IBM Plex Mono from Google Fonts. Both are
available under the SIL Open Font License 1.1. Their source and copyright
notices are available from Google Fonts. [Public Sans](https://github.com/google/fonts/tree/main/ofl/publicsans) ·
[IBM Plex Mono](https://github.com/google/fonts/tree/main/ofl/ibmplexmono)
