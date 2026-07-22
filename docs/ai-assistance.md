# AI assistance and ownership

## The short version

Brayden Toulouse directed this work. AI coding agents wrote most of the code.
Both of those statements are true and neither is hedged.

## What that means concretely

**Brayden's contribution:**

- Chose the problem, from having done the manual version of it. The design
  decisions that matter here — that a count sheet must be patched in place
  rather than regenerated; that a spoken bare integer must never terminate a
  line because SKU names contain numbers; that a case count must refuse to
  produce a number instead of guessing a pack size — come from knowing how the
  work is actually done, not from knowing TypeScript.
- Set the architectural constraint the whole repository is organized around:
  the probabilistic/deterministic boundary, and the rule that no model call
  sits in the per-count path.
- Defined acceptance criteria, including that a false auto-fill is worse than a
  missed one, and set the review threshold policy accordingly.
- Ran the system against real audio, read the transcripts, and identified the
  failures that became the grammar's hardest rules — the `leader` mishearing,
  the `7 50` digit-pair split, the directive-anchoring bug, backward-attaching
  user flags.
- Reviewed, tested, and accepted or rejected agent output. Verified results
  rather than trusting them.

**The agents' contribution:**

- Most of the implementation code, the test cases, and the prose in these docs,
  under instruction and review.

## What is *not* being claimed

- Not claimed: that Brayden wrote this line by line unaided.
- Not claimed: any machine-learning research contribution. No model was
  trained, fine-tuned, or evaluated as a model. The ASR providers are consumed
  as services.
- Not claimed: production security or scale expertise. This is a proof of
  concept extracted from a proof of concept.
- Not claimed: that the accuracy number in [evaluation.md](evaluation.md) is a
  benchmark. It is one synthetic run, caveated in place.

## Why publish it this way

The interesting engineering here is not the code volume, it is the judgement:
where to put the boundary between a probabilistic model and a system that has
to be right, what to do with the uncertainty that crosses it, and when the
correct answer is to stop and ask a human. That judgement is Brayden's, it is
legible in the design, and it is the part worth evaluating.

Working effectively with coding agents — specifying tightly, constraining
scope, verifying output, and refusing to ship claims that were not observed —
is itself the skill being demonstrated.
