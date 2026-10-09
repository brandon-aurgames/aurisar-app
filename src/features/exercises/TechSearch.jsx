import React, { memo } from 'react';

/**
 * Shared search field for the library, My Exercises, the workout picker,
 * and the editor's start-from search. `label` is the accessible name;
 * placeholder is a hint, not the name.
 */
const TechSearch = memo(function TechSearch({
  value,
  onChange,
  onClear,
  placeholder = "Search…",
  label,
  autoFocus = false,
  id,
}) {
  return (
    <div className={"tech-search-wrap"} style={{ flex: 1, marginBottom: 0 }}>
      {label && id && <label htmlFor={id} className={"sr-only"}>{label}</label>}
      <span className={"tech-search-icon"} aria-hidden="true">{"🔍"}</span>
      <input
        id={id}
        className={"tech-search-inp"}
        type={"search"}
        placeholder={placeholder}
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
      />
      {!!value && (
        <button
          type={"button"}
          aria-label={"Clear search"}
          className={"tech-search-clear"}
          onClick={onClear}
        >{"✕"}</button>
      )}
    </div>
  );
});

export default TechSearch;
