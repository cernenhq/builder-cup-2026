# Third-party notices

This repository includes or uses the third-party material listed below. Each item stays under its own licence.

The project's own code is not licensed under any of these terms. The repository has no licence file on purpose: no licence is granted for the project's own code.

## three.js (r128)

File: `public/static/owner/three.min.js` (unmodified minified build). Its header reads "Copyright 2010-2021 Three.js Authors" and "SPDX-License-Identifier: MIT".

```
The MIT License

Copyright 2010-2021 Three.js Authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Site footage: IITU dataset (CC BY 4.0)

Arman Keresh, "IITU Multi-Temporal Building Floor-Count Dataset: 12-Month Fixed-Viewpoint Construction Sequence", Mendeley Data, Version 1, 2026, doi:10.17632/ww7rt2rnk6.1. Licensed under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/

Modifications: 11 monthly frames were extracted, aligned to one camera view, resized to 1120x630, and blurred at street level. The frames are in `seed-photos/`. The screenshots in `docs/screens/` contain these modified frames.

Street level is blurred. Small, unidentifiable figures can remain visible on the rooftop, and parts of the frame edges are not blurred. No faces or plates are readable.

The frames are used only for the fictional demo project P-001. The dataset author does not endorse this project.

## npm dependencies

The packages installed by `npm install` (listed with exact versions in `package-lock.json`) are under their own licences. They are not copied into this repository.
