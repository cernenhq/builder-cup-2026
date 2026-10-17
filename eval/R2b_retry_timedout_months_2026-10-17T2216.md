# R2b (retry of timed-out months only; NOT the scored run): v3 readers against the frozen reference (2026-10-17T22:16:04.553Z)

Model: gemini-3.8-flash on Vertex AI. Setup: v3 Node readers (prompt in src/ai/prompt.js), one photo per month, no earlier corrections.
Reference: the 28 of 37 statement lines where two AI labellers (Claude and GPT, labelled blind, frozen before any Gemini run) agree. This is a provisional AI reference, not ground truth.

| | Agrees with the reference | Overclaims caught (of 7) |
|---|---|---|
| Accept every line | 17/28 | 0/7 |
| v3 AI default (two Gemini readers) | 22/28 | 6/7 |
| Reader A alone | 25/28 | |
| Reader B alone | 22/28 | |

On reference lines the readers disagreed (no default, the person decides) 3 times; no answer 0. The default said "supported" where the reference did not 0 times.
Across all 37 answered lines the two readers disagreed on 3.
Timing: median model call 18627 ms; median time per claimed line 12365 ms (both readers run in parallel; one call covers all lines in a month).
Estimated spend for this run: US$0.0398 (cap US$1.05).
One run; not a noise estimate. Development data: the prompt was written by the team before this run, but the reference labels and claims were also written by the team.
