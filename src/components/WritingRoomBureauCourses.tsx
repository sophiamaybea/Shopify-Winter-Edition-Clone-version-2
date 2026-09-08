"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import styles from "./WritingRoomBureauCourses.module.css";

type Course = {
  no: string;
  slug: string;
  title: string;
  craft: string;
  kind: string;
  serial: string;
  stamp: string;
  line1: string;
  line2: string;
  description: string;
  className: string;
  artifactSrc: string;
  stampSrc: string;
  perforated?: boolean;
};

const COURSES: Course[] = [
  {
    no: "01",
    slug: "night-clerks-registry",
    title: "THE NIGHT CLERK'S REGISTRY",
    craft: "REVISION",
    kind: "MOTEL REGISTRY CARD",
    serial: "NC-050624",
    stamp: "REVISED • ROOM CLEARED",
    line1: "CHECK IN: THE DRAFT YOU HAVE",
    line2: "CHECK OUT: THE DRAFT IT NEEDS",
    description:
      "A revision room built around evidence, contradiction, omission and the sharper second look.",
    className: styles.registry,
    artifactSrc: "/wrb/course-artifacts/01_night-clerks-registry.svg",
    stampSrc: "/wrb/course-stamps/01_night-clerks-registry_stamp.svg",
  },
  {
    no: "02",
    slug: "correspondence-society",
    title: "THE CORRESPONDENCE SOCIETY",
    craft: "VOICE",
    kind: "MEMBERSHIP / MAIL CARD",
    serial: "CS-021705",
    stamp: "POSTMARKED • VOICE FOUND",
    line1: "FROM: THE SENTENCE",
    line2: "TO: THE PERSON WHO MUST HEAR IT",
    description:
      "Voice through address, intimacy, rhythm, distance and the letter that changes because somebody specific is receiving it.",
    className: styles.correspondence,
    artifactSrc: "/wrb/course-artifacts/02_correspondence-society.svg",
    stampSrc: "/wrb/course-stamps/02_correspondence-society_stamp.svg",
  },
  {
    no: "03",
    slug: "dining-room-dialogue",
    title: "THE DINING-ROOM DIALOGUE",
    craft: "DIALOGUE",
    kind: "RESERVATION CHIT",
    serial: "DD-092307",
    stamp: "TABLE HELD • SUBTEXT SERVED",
    line1: "PARTY: TWO PEOPLE WHO WANT DIFFERENT THINGS",
    line2: "SPECIAL: THE LINE NOBODY ANSWERS",
    description:
      "Dialogue as appetite and friction: interruption, evasion, status, subtext and what sits on the table between two people.",
    className: styles.dining,
    artifactSrc: "/wrb/course-artifacts/03_dining-room-dialogue.svg",
    stampSrc: "/wrb/course-stamps/03_dining-room-dialogue_stamp.svg",
  },
  {
    no: "04",
    slug: "alpine-hotel-ledger",
    title: "THE ALPINE HOTEL LEDGER",
    craft: "PLOTTING",
    kind: "HOTEL FOLIO / KEY TAG",
    serial: "AH-121498",
    stamp: "ROOM 04 • PLOT IN MOTION",
    line1: "ARRIVAL: DESIRE",
    line2: "DEPARTURE: CONSEQUENCE",
    description:
      "Plot as an occupied building: arrivals, exits, collisions, escalation and the consequences of putting the wrong people in neighbouring rooms.",
    className: styles.hotel,
    artifactSrc: "/wrb/course-artifacts/04_alpine-hotel-ledger.svg",
    stampSrc: "/wrb/course-stamps/04_alpine-hotel-ledger_stamp.svg",
  },
  {
    no: "05",
    slug: "airborne-story-permit",
    title: "THE AIRBORNE STORY PERMIT",
    craft: "CHARACTERS",
    kind: "BOARDING PASS",
    serial: "AS-773618",
    stamp: "CLEARED TO DEPART",
    line1: "FROM: WHO THEY SAY THEY ARE",
    line2: "TO: WHO THEY BECOME IN TRANSIT",
    description:
      "Character through baggage, route, contradiction, behaviour and what a person reveals when they are forced to move.",
    className: styles.airborne,
    artifactSrc: "/wrb/course-artifacts/05_airborne-story-permit.svg",
    stampSrc: "/wrb/course-stamps/05_airborne-story-permit_stamp.svg",
    perforated: true,
  },
  {
    no: "06",
    slug: "programme-unmade-pictures",
    title: "THE PROGRAMME OF UNMADE PICTURES",
    craft: "SCENEWRITING",
    kind: "CINEMA TICKET",
    serial: "UP-021986",
    stamp: "ADMIT ONE • SCENE 06",
    line1: "FEATURE: THE MOMENT UNDER PRESSURE",
    line2: "RUN TIME: UNTIL SOMETHING CHANGES",
    description:
      "Scenewriting through entrance, exit, object, gesture, pressure and the exact moment after which the room is no longer the same.",
    className: styles.cinema,
    artifactSrc: "/wrb/course-artifacts/06_programme-unmade-pictures.svg",
    stampSrc: "/wrb/course-stamps/06_programme-unmade-pictures_stamp.svg",
    perforated: true,
  },
];

function CourseTicket({ course }: { course: Course }) {
  return (
    <>
      <span className={styles.depth} aria-hidden="true" />
      <div className={`${styles.ticketAssetShell} ${course.className}`}>
        <img
          className={styles.ticketAsset}
          src={course.artifactSrc}
          alt={`${course.title} — ${course.kind}`}
          draggable={false}
        />
        <img
          className={styles.stampAsset}
          src={course.stampSrc}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      </div>
    </>
  );
}

export function WritingRoomBureauCourses() {
  const [mount, setMount] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const portal = document.createElement("div");
    portal.dataset.wrbCoursePortal = "true";
    portal.style.width = "100%";
    portal.style.pointerEvents = "auto";
    setMount(portal);

    return () => {
      portal.remove();
      setMount(null);
    };
  }, []);
  const [active, setActive] = useState<Course | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const hiddenNodes = useRef<Array<{ element: HTMLElement; display: string }>>([]);
  const courseBySlug = useMemo(
    () => new Map(COURSES.map((course) => [course.slug, course])),
    []
  );

  useEffect(() => {
    const section = document.querySelector<HTMLElement>('[data-section-id="online"]');
    if (!section) return;

    if (!mount) return;

    hiddenNodes.current = Array.from(section.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement)
      .map((element) => ({ element, display: element.style.display }));

    hiddenNodes.current.forEach(({ element }) => {
      element.style.display = "none";
    });

    section.style.pointerEvents = "auto";
    section.style.overflow = "visible";
    section.appendChild(mount);

    return () => {
      hiddenNodes.current.forEach(({ element, display }) => {
        element.style.display = display;
      });
      mount.remove();
    };
  }, [mount]);

  useEffect(() => {
    if (!mount || !rootRef.current) return;
    let cancelled = false;
    let cleanup = () => {};

    void (async () => {
      const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (cancelled || !rootRef.current) return;
      gsap.registerPlugin(ScrollTrigger);
      const ctx = gsap.context(() => {
        gsap.fromTo(
          "[data-wrb-ticket]",
          { y: 75, rotateX: 9, opacity: 0 },
          {
            y: 0,
            rotateX: 0,
            opacity: 1,
            stagger: 0.08,
            duration: 0.85,
            ease: "power3.out",
            scrollTrigger: {
              trigger: "[data-wrb-grid]",
              start: "top 84%",
            },
          }
        );
      }, rootRef.current);
      cleanup = () => ctx.revert();
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [mount]);

  useEffect(() => {
    const onHash = () => {
      const slug = window.location.hash.replace(/^#course-/, "");
      const course = courseBySlug.get(slug);
      if (course) setActive(course);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [courseBySlug]);

  if (!mount) return null;

  return createPortal(
    <section
      ref={(node) => {
        rootRef.current = node;
      }}
      className={styles.host}
      aria-labelledby="wrb-course-heading"
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - box.left) / box.width) * 100;
        const y = ((event.clientY - box.top) / box.height) * 100;
        event.currentTarget.style.setProperty("--mx", `${x}%`);
        event.currentTarget.style.setProperty("--my", `${y}%`);
      }}
    >
      <header className={styles.header}>
        <p className={styles.kicker}>THE WRITING ROOM BUREAU / SIX WORLDS</p>
        <h2 id="wrb-course-heading">Choose your room.</h2>
        <p className={styles.headerCopy}>
          Six cinematic writing worlds. Every paper artefact is navigation, prompt,
          progress marker and collectible.
        </p>
      </header>

      <div className={styles.grid} data-wrb-grid>
        {COURSES.map((course, index) => (
          <motion.button
            key={course.slug}
            type="button"
            className={styles.card}
            data-wrb-ticket
            aria-label={`Open ${course.title}`}
            onClick={() => {
              setActive(course);
              window.history.replaceState(null, "", `#course-${course.slug}`);
            }}
            drag
            dragSnapToOrigin
            dragElastic={0.16}
            whileHover={{
              y: -11,
              scale: 1.015,
              rotateZ: index % 2 ? 0.65 : -0.65,
              rotateX: -1.5,
            }}
            whileTap={{ y: -2, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 290, damping: 24 }}
          >
            <CourseTicket course={course} />
          </motion.button>
        ))}
      </div>

      <p className={styles.instruction}>
        Hover to lift • drag the paper • click a course to inspect it
      </p>

      <AnimatePresence>
        {active ? (
          <motion.div
            className={styles.backdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setActive(null)}
          >
            <motion.article
              className={styles.drawer}
              initial={{ y: 70, rotateX: 8, opacity: 0 }}
              animate={{ y: 0, rotateX: 0, opacity: 1 }}
              exit={{ y: 45, opacity: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 24 }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className={styles.close}
                aria-label="Close course"
                onClick={() => setActive(null)}
              >
                ×
              </button>
              <p className={styles.drawerLabel}>
                COURSE {active.no} / {active.craft}
              </p>
              <h3>{active.title}</h3>
              <p>{active.description}</p>
              <button type="button" className={styles.enter}>
                ENTER THIS ROOM →
              </button>
            </motion.article>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>,
    mount
  );
}
