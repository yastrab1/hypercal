import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  type ComponentProps,
} from "react";
import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import { CalendarCanvas } from "./Calendar";
import { monthRange, shiftPeriod } from "./period.mjs";
import { observeMonthWheel } from "./month-wheel.mjs";
import { observeScrollEnd } from "./scroll-end.mjs";

type Props = ComponentProps<typeof CalendarCanvas> & {
  continuous?: boolean;
  onApproach?: (date: Date) => void;
  onViewportDate: (date: Date) => void;
};
export function CalendarViewport({
  continuous,
  onViewportDate,
  onApproach,
  ...props
}: Props) {
  if (!continuous || !["month", "week"].includes(props.layout))
    return <CalendarCanvas {...props} />;
  return (
    <ContinuousCalendar
      {...props}
      onViewportDate={onViewportDate}
      onApproach={onApproach}
      key={props.layout}
    />
  );
}
function ContinuousCalendar({
  onViewportDate,
  onApproach,
  ...props
}: Omit<Props, "continuous">) {
  const month = props.layout === "month";
  const center = month ? 1000 : 5000,
    total = center * 2,
    before = month ? 6 : 7,
    count = month ? 18 : 21;
  const [origin, setOrigin] = useState(() =>
    month ? monthRange(props.date).from : startOfDay(props.date),
  );
  const [windowIndex, setWindowIndex] = useState(center - before);
  const [size, setSize] = useState({
    width: 700,
    height: 600,
    compact: matchMedia("(max-width: 760px)").matches,
  });
  const root = useRef<HTMLDivElement>(null);
  const reported = useRef(props.date.getTime());
  const dimensions = useRef(0);
  const visibleIndex = useRef(center);
  const frame = useRef(0);
  const settleRef = useRef<() => void>(() => {});
  const callbacks = useRef({ onViewportDate, onApproach });
  callbacks.current = { onViewportDate, onApproach };
  const navigationDate = useRef(props.date);
  navigationDate.current = props.date;
  useEffect(() => {
    if (!month) return;
    return observeMonthWheel(root.current!, (step) =>
      callbacks.current.onViewportDate(
        shiftPeriod(navigationDate.current, "month", step),
      ),
    );
  }, [month]);
  const lastApproach = useRef(-1);
  // The gutter follows the viewport media query used by CalendarCanvas,
  // not the available calendar width after the desktop sidebar is deducted.
  const gutter = size.compact ? 36 : 60;
  const unit = month
    ? Math.max(30, (size.height - 36) / 6)
    : Math.max(1, (size.width - gutter) / 7);
  const dayAt = (index: number) =>
    addDays(origin, (index - center) * (month ? 7 : 1));
  useLayoutEffect(() => {
    const element = root.current!;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
        compact: matchMedia("(max-width: 760px)").matches,
      }),
    );
    observer.observe(element);
    if (!month) element.scrollTop = 7 * 64;
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (
      reported.current === props.date.getTime() &&
      dimensions.current === unit
    )
      return;
    const resized = dimensions.current !== unit && dimensions.current !== 0;
    const currentIndex =
      resized && reported.current === props.date.getTime()
        ? visibleIndex.current
        : null;
    dimensions.current = unit;
    const target = month ? monthRange(props.date).from : startOfDay(props.date);
    let index =
      currentIndex ??
      center + differenceInCalendarDays(target, origin) / (month ? 7 : 1);
    if (index < before || index > total - count) {
      setOrigin(target);
      index = center;
    }
    reported.current = props.date.getTime();
    visibleIndex.current = index;
    setWindowIndex(
      Math.max(0, Math.min(total - count, Math.floor(index) - before)),
    );
    root.current!.scrollTo(
      month
        ? { top: index * unit, behavior: "instant" }
        : { left: index * unit, behavior: "instant" },
    );
    lastApproach.current = -1;
    callbacks.current.onApproach?.(
      currentIndex !== null ? dayAt(currentIndex) : target,
    );
  }, [props.date.getTime(), unit]);
  useEffect(() => {
    const stop = observeScrollEnd(root.current!, () => settleRef.current());
    return () => {
      cancelAnimationFrame(frame.current);
      stop();
    };
  }, []);
  const position = () => {
    const element = root.current!;
    return Math.max(
      0,
      Math.min(
        total - 7,
        Math.floor(
          (month ? element.scrollTop : element.scrollLeft) / unit + 0.01,
        ),
      ),
    );
  };
  const settled = () => {
    const element = root.current;
    if (!element) return;
    const offset = month ? element.scrollTop : element.scrollLeft;
    const index = Math.max(0, Math.min(total - 7, Math.round(offset / unit)));
    const target = index * unit;
    // CSS scroll-snap can re-anchor as the virtual window is recycled. Keep
    // native input/inertia untouched, and settle once the gesture is idle.
    if (Math.abs(offset - target) > 1) {
      element.scrollTo(
        month
          ? {
              top: target,
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "instant"
                : "smooth",
            }
          : {
              left: target,
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "instant"
                : "smooth",
            },
      );
      return;
    }
    const date = addDays(dayAt(index), month ? 3 : 0);
    if (reported.current !== date.getTime()) {
      reported.current = date.getTime();
      callbacks.current.onViewportDate(date);
    }
  };
  settleRef.current = settled;
  const scroll = () => {
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const index = position();
        visibleIndex.current = index;
        // Move only the rendered window. Never reset scrollLeft/scrollTop here.
        if (index < windowIndex + 3 || index > windowIndex + count - 10) {
          const next = Math.max(0, Math.min(total - count, index - before));
          startTransition(() =>
            setWindowIndex((old) => (old === next ? old : next)),
          );
        }
        if (lastApproach.current !== index) {
          lastApproach.current = index;
          callbacks.current.onApproach?.(dayAt(index));
        }
      });
  };
  return (
    <div
      ref={root}
      className={`continuous-calendar continuous-${month ? "month" : "week"}`}
      role="region"
      aria-label={`Continuously scrolling ${props.layout}`}
      tabIndex={0}
      onScroll={scroll}
      onKeyDown={(event) => {
        if (event.target !== root.current) return;
        const step = month
          ? (
              { ArrowUp: -1, ArrowDown: 1, PageUp: -6, PageDown: 6 } as Record<
                string,
                number
              >
            )[event.key]
          : ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[
              event.key
            ];
        if (!step) return;
        event.preventDefault();
        event.stopPropagation();
        const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth";
        root.current?.scrollBy(
          month
            ? { top: step * unit, behavior }
            : { left: step * unit, behavior },
        );
      }}
    >
      <div
        className="continuous-spacer"
        style={
          month
            ? { height: 36 + total * unit }
            : { width: gutter + total * unit, height: "100%" }
        }
      >
        <div
          className="continuous-buffer"
          style={
            month
              ? {
                  top: windowIndex * unit,
                  height: 36 + count * unit,
                  width: "100%",
                }
              : {
                  left: windowIndex * unit,
                  width: gutter + count * unit,
                  height: "100%",
                }
          }
        >
          <StableCalendar
            {...props}
            monthWindow={
              month ? { start: dayAt(windowIndex), weeks: count } : undefined
            }
            weekWindow={
              !month ? { start: dayAt(windowIndex), days: count } : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}

// Updating the prefetch window or spinner does not rebuild hundreds of time slots.
function StableCalendar(props: ComponentProps<typeof CalendarCanvas>) {
  const latest = useRef(props);
  latest.current = props;
  return useMemo(
    () => (
      <CalendarCanvas
        {...props}
        onEvent={(...args) => latest.current.onEvent(...args)}
        onCreate={(...args) => latest.current.onCreate(...args)}
        onDate={(...args) => latest.current.onDate(...args)}
        onExpandDay={(...args) => latest.current.onExpandDay(...args)}
        onEdit={
          props.onEdit
            ? (...args) => latest.current.onEdit?.(...args)
            : undefined
        }
      />
    ),
    [
      props.layout,
      props.date.getTime(),
      props.events,
      props.calendars,
      props.readOnly,
      !!props.onEdit,
      props.monthWindow?.start.getTime(),
      props.monthWindow?.weeks,
      props.weekWindow?.start.getTime(),
      props.weekWindow?.days,
    ],
  );
}
