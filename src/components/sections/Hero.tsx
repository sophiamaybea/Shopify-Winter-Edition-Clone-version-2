"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Wordmark } from "@/components/ui/Wordmark";
import { RomanNav } from "@/components/ui/RomanNav";
import { RealScene } from "@/components/ui/RealScene";

export function Hero() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  const cardOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
  const cardY = useTransform(scrollYProgress, [0, 0.6], ["0%", "-8%"]);

  return (
    <section
      id="hero"
      ref={ref}
      className="relative min-h-[150svh]"
    >
      <div className="sticky top-0 h-svh">
        <RealScene
          sceneId="hero"
          scrollTarget="#hero"
        />
        <motion.div
          style={reduce ? undefined : { opacity: cardOpacity, y: cardY }}
          className="absolute inset-0 z-10 flex items-center justify-center"
        >
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.5, ease: "easeOut" }}
            className="w-[min(90vw,420px)] border border-white/70 bg-black/10 p-8 text-white backdrop-blur-[2px]"
          >
            <Wordmark size="lg" />
            <p className="mt-8 font-serif text-lg leading-snug">
              Finish better writing.
              <br />
              Not just another writing course.
            </p>
            <div className="mt-6">
              <RomanNav tone="dark" />
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
