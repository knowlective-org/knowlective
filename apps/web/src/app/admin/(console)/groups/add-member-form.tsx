"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { StatusRow } from "@/components/status-row";
import styles from "@/styles/ui.module.css";
import picker from "./member-picker.module.css";
import { type MemberCandidate, addGroupMembers, searchMemberCandidates } from "./actions";

// How long typing has to pause before searching.
const SEARCH_DELAY_MS = 200;

// Adding members to a group: search by name or email address as you type
// (the server matches, as addresses are stored encrypted), pick people from
// the suggestions — they become badges in the box — and add them all at once.
// Keyboard: ↑↓ to move, Enter to pick, Esc to close, Backspace on an empty
// box to drop the last badge.
export function AddMemberForm({ groupId }: { groupId: string }) {
  const ta = useTranslations("admin");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<MemberCandidate[]>([]);
  // Suggestions for `forQuery` (null: none asked for yet).
  const [results, setResults] = useState<{ forQuery: string; candidates: MemberCandidate[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<{ error?: string; added?: number }>({});
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Search after a short pause; answers to older queries are dropped.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let stale = false;
    const timer = setTimeout(() => {
      void searchMemberCandidates(groupId, q).then((candidates) => {
        if (!stale) setResults({ forQuery: q, candidates });
      });
    }, SEARCH_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [groupId, query]);

  const pickedIds = new Set(picked.map((p) => p.id));
  const current = results && results.forQuery === query.trim() ? results.candidates : null;
  const candidates = (current ?? []).filter((c) => !pickedIds.has(c.id));
  const showList = open && query.trim() !== "" && current !== null;
  const activeIndex = Math.min(active, Math.max(candidates.length - 1, 0));
  const label = (c: MemberCandidate) => c.name || c.email;

  const pick = (candidate: MemberCandidate) => {
    setPicked((list) => (list.some((p) => p.id === candidate.id) ? list : [...list, candidate]));
    setQuery("");
    setActive(0);
    setStatus({});
    input.current?.focus();
  };
  const unpick = (id: string) => setPicked((list) => list.filter((p) => p.id !== id));

  const submit = () => {
    if (picked.length === 0) {
      setStatus({ error: ta("groups.errors.pickSomeone") });
      return;
    }
    startTransition(async () => {
      const result = await addGroupMembers(
        groupId,
        picked.map((p) => p.id),
      );
      setStatus(result);
      if (!result.error) {
        setPicked([]);
        setResults(null);
      }
    });
  };

  return (
    <form
      data-ui="AddMemberForm"
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <label htmlFor={`${listId}-input`}>{ta("groups.memberSearch")}</label>
        <div className={picker.picker}>
          <div className={picker.box} onClick={() => input.current?.focus()}>
            {picked.map((p) => (
              <span key={p.id} className={picker.chip} title={p.email} data-ui="AddMemberForm.pickedItem" data-id={p.id}>
                <span className={picker.chipLabel}>{label(p)}</span>
                <button
                  type="button"
                  className={picker.chipRemove}
                  aria-label={ta("groups.removePicked", { who: label(p) })}
                  onClick={() => unpick(p.id)}
                  data-ui="AddMemberForm.removePickedButton"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              ref={input}
              id={`${listId}-input`}
              className={picker.input}
              value={query}
              placeholder={picked.length === 0 ? ta("groups.memberSearchPlaceholder") : ""}
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-expanded={showList}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={showList && candidates.length > 0 ? `${listId}-${activeIndex}` : undefined}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              // Later than a click on a suggestion (which picks first).
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "ArrowDown" && candidates.length > 0) {
                  e.preventDefault();
                  setOpen(true);
                  setActive((activeIndex + 1) % candidates.length);
                } else if (e.key === "ArrowUp" && candidates.length > 0) {
                  e.preventDefault();
                  setActive((activeIndex - 1 + candidates.length) % candidates.length);
                } else if (e.key === "Enter") {
                  // Enter picks; it submits only with nothing being typed.
                  if (query.trim()) {
                    e.preventDefault();
                    if (showList && candidates[activeIndex]) pick(candidates[activeIndex]);
                  }
                } else if (e.key === "Escape") {
                  setOpen(false);
                } else if (e.key === "Backspace" && query === "" && picked.length > 0) {
                  unpick(picked[picked.length - 1].id);
                }
              }}
              data-ui="AddMemberForm.searchInput"
            />
          </div>
          {showList && (
            <ul id={listId} role="listbox" className={picker.list} data-ui="AddMemberForm.candidateList">
              {candidates.length === 0 ? (
                <li className={picker.empty} data-ui="AddMemberForm.noCandidates">
                  {ta("groups.noCandidates")}
                </li>
              ) : (
                candidates.map((c, i) => (
                  <li
                    key={c.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={picker.option}
                    // Keep the focus in the input.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(c)}
                    data-ui="AddMemberForm.candidateItem"
                    data-id={c.id}
                  >
                    <span>
                      {c.name || c.email}
                      {c.disabled && <span className={picker.disabledMark}>({ta("groups.disabledUser")})</span>}
                    </span>
                    {c.name && <span className={picker.optionEmail}>{c.email}</span>}
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <span className={styles.note}>{ta("groups.memberSearchNote")}</span>
      </div>
      <StatusRow
        message={status.error ?? (status.added !== undefined ? ta("groups.addedCount", { count: status.added }) : "")}
        className={status.error ? styles.error : styles.success}
        dataUi="AddMemberForm.status"
      >
        <button data-ui="AddMemberForm.submitButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? ta("groups.adding") : ta("groups.addMember")}
        </button>
      </StatusRow>
    </form>
  );
}
