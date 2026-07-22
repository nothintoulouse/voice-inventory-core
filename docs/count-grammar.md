# The count grammar

A person counting a bar does not speak in sentences. They say the product, then
how much of it is left, and move on — three to six words per bottle, hundreds of
times an hour. The grammar's job is to turn that stream into
`{ item, size hint, count, flags }` with no model in the loop.

Every rule below is covered by tests in `src/count-grammar/__tests__/`.

## Shape of a line

```
line    := [item phrase] [size] count-expression [user flag]
         | 'plus' | 'add' count-expression item-phrase      (additive)
         | item-phrase 'plus' count-expression              (trailing additive)
         | 'new item' item-phrase [size] [count]
         | item-phrase ('not here' | 'skip')                (directives)
```

The count is found as a **suffix**, not by position, because the item phrase can
itself contain numbers.

## Count expressions

```
count   := 'case' | 'cases' ['plus' simple]
         | <int> ('case' | 'cases') ['plus' simple]
         | simple ['and' simple]
simple  := 'full' | 'empty' | 'half' | 'quarter' | 'three quarters'
         | <int> 'tenths' | decimal | <int> ['full']
```

| Spoken | Value |
|---|---|
| `full` | 1.0 |
| `empty` | 0.0 |
| `half` | 0.5 |
| `quarter` / `a quarter` | 0.25 |
| `three quarters` | 0.75 |
| `point five` / `zero point five` / `five tenths` / `0.5` | 0.5 |
| `two full` | 2.0 |
| `one point seven five` / `1.75` | 1.75 |
| `case plus three` | 1 case + 3 each |
| `two cases plus three` | 2 cases + 3 each |

Case counts never resolve to a number. Pack size is a property of the SKU, not
of the utterance, so the parser emits `{ type: 'case', cases, extraEach }` and a
`case_pack_needed` flag rather than inventing a multiplier.

## Spoken numbers

`parseSpokenInteger` handles, in priority order:

1. digit tokens (`750`, `107`) — smart-formatted ASR emits these;
2. the hospitality hundreds shorthand: `seven fifty` → 750, `seventeen fifty` →
   1750, `seven seventy five` → 775;
3. digit readouts of three or more units including `oh`: `one oh seven` → 107;
4. ordinary composition: `seventy five` → 75, `two hundred` → 200.

`parseSpokenDecimal` handles `point five` → 0.5, `one point seven five` → 1.75,
and bare decimal tokens. Integers are deliberately *not* accepted as decimals,
so the two paths never race.

## Sizes

Size expressions are only consulted **between the item phrase and the count**,
which is what makes a bare integer safe there. `grey`-area cases the tests pin
down:

- `liter` / `litre` / **`leader`** → 1000 mL. `leader` is not a typo: both cloud
  providers reliably transcribe spoken "liter" that way, so it is in the size
  vocabulary.
- `handle` → 1750 mL.
- `seven fifty` → 750; Deepgram's `numerals=true` splits this into the digit
  pair `7 50`, which is handled explicitly.
- `one point seven five` / `1.75` → 1750 mL, but only when the resulting value
  is a plausible bottle size.

## Compound counts

`one full and point four` is unambiguous: 1.4.

`one full and one point four` is not — the speaker may mean 2.4 (two containers)
or 1.4 (one container at 0.4). This is a house rule, not a parsing problem, so
it is configuration:

| `compoundConvention` | Result | Flag |
|---|---|---|
| `literal` | 2.4 | — |
| `reinterpret` | 1.4 | — |
| `flag` (default) | 2.4 | `ambiguous_compound` |

The default refuses to guess and sends the line to a human.

## Protecting numeric item names

The hardest real case. `harbor one oh seven point four` could parse as:

- item `harbor`, count `107.4` — implausible, and wrong;
- item `harbor one oh seven`, count `0.4` — correct.

The parser enumerates *every* valid count suffix, discards implausible ones
(above `maxPlausibleCount`, default 40), then ranks the survivors by what the
remaining prefix would look like as an item name:

| Prefix quality | Meaning |
|---|---|
| 2 | clean — empty, ends in a plain word, or ends in a recognized size |
| 1 | ends in a complete number — plausible for a numeric SKU name |
| 0 | broken — ends mid-decimal (`… one point seven`) or on a dangling operator |

Highest quality wins, longest-first within a tier. Choosing a shorter suffix
than the greedy one costs 0.1 of parse confidence (`shortened_count_suffix`),
because the parser should be less sure when it had to make that choice.

`harbor 107.8` — where the ASR's numerals setting merged the name and the count
into one token — is *not* recoverable by this rule. It parses as an implausible
count and goes to review. That is the correct outcome, and it is a documented
gap rather than a solved case; see [evaluation.md](evaluation.md).

## Additive lines

An additive line explicitly increments a running total rather than starting a
new count — the speaker found two more bottles in the well:

- `plus point four fowler's` → +0.4
- `add a bottle of marlo's` → +1
- `fowlers plus point four` → +0.4 (trailing form)

`bison creek case plus three` is *not* additive: the `plus` belongs to the case
expression, and longest-match inside the count parser consumes it first.

## Flags

Flags are the grammar's way of saying what it was unsure about. They flow
straight into the review reasons.

| Flag | Meaning |
|---|---|
| `ambiguous_compound` | house-rule collision, see above |
| `implausible_count` | value above `maxPlausibleCount` |
| `case_pack_needed` | case count with no pack size known |
| `quarters_disabled` | quarters spoken but turned off for this property |
| `shortened_count_suffix` | a shorter count was chosen to protect the item name |
| `user_flag` | the speaker said "flag this" / "hard to pronounce" |
| `no_count` | an item phrase with no count expression |
| `no_item` | a count with no item phrase |
