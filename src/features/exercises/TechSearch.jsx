import React, { memo } from 'react';

/**
 * Shared search field for the library, My Exercises, and the workout picker.
 */
const TechSearch = memo(function TechSearch({
  value,
  onChange,
  onClear,
  placeholder = "Search…",
  autoFocus = false,
  id,
}) {
  return (
    <div className={"tech-search-wrap"} style={{ flex: 1, marginBottom: 0 }}>
      <span className={"tech-search-icon"} aria-hidden="true">{"🔍"}</span>
      <input
        id={id}
        className={"tech-search-inp"}
        type={"search"}
        placeholder={placeholder}
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
