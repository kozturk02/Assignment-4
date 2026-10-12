import { Children, useId } from 'react';
import { useSearchParams } from 'react-router-dom';

// Each review area keeps its own selection in the URL, including on refresh.
export default function ReviewTabs({ scope, label, defaultValue, children }) {
  const [params, setParams] = useSearchParams();
  const id = useId();
  const panels = Children.toArray(children).filter(Boolean);
  const requested = params.get(`${scope}View`) || defaultValue;
  const selected = panels.find(panel => panel.props.value === requested) || panels[0];

  function select(value) {
    const next = new URLSearchParams(params);
    next.set(`${scope}View`, value);
    setParams(next);
  }

  function move(event, index) {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % panels.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + panels.length) % panels.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = panels.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    select(panels[next].props.value);
    event.currentTarget.parentElement.children[next].focus();
  }

  return <div className="review-content">
    <div className="secondary-tabs" role="tablist" aria-label={label}>
      {panels.map((panel, index) => <button key={panel.props.value} type="button" role="tab"
        id={`${id}-${panel.props.value}`} aria-controls={`${id}-panel`}
        aria-selected={panel === selected} tabIndex={panel === selected ? 0 : -1}
        onClick={() => select(panel.props.value)} onKeyDown={event => move(event, index)}>
        {panel.props.label}
      </button>)}
    </div>
    <div className="review-panel" role="tabpanel" id={`${id}-panel`}
      aria-labelledby={`${id}-${selected.props.value}`} tabIndex={0} key={selected.props.value}>
      {selected.props.children}
    </div>
  </div>;
}

export function ReviewPanel({ children }) { return children; }
