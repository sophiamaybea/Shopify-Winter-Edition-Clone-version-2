"use client";

import { useEffect } from "react";

function setMediaVisible(root: Element) {
  for (const element of root.querySelectorAll<HTMLElement>(".opacity-0")) {
    element.style.opacity = "1";
  }
}

export function CapturedEnhancements() {
  useEffect(() => {
    const html = document.documentElement;
    const sideAndLines = document.querySelector<HTMLElement>(
      '[data-section-name="side-and-lines"]'
    );
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>(
        "section[data-section-id], [data-section-id='hero']"
      )
    );

    sideAndLines?.setAttribute("data-initiated", "true");
    sideAndLines?.setAttribute("data-sidebar-ready", "true");
    sideAndLines?.setAttribute("data-sidebar-loaded", "true");

    const updateScrollState = () => {
      // The production coordinator switches the title/index treatment after
      // the first 100 CSS pixels, independent of the translated hero marker.
      const scrolled = window.scrollY > 100;
      sideAndLines?.setAttribute("data-scrolled", String(scrolled));

      const sampleY = Math.min(80, window.innerHeight * 0.1);
      const themed = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-nav-theme], [data-sidebar-theme], [data-title-theme]"
        )
      )
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top <= sampleY && rect.bottom > sampleY;
        })
        .at(-1);

      html.dataset.navTheme = themed?.dataset.navTheme ?? "dark";
      html.dataset.navBg = themed?.dataset.navBg ?? "transparent";
      html.dataset.navStyle = themed?.dataset.navStyle ?? "default";
      html.dataset.sidebarTheme =
        themed?.dataset.sidebarTheme ??
        (html.dataset.navTheme === "light" ? "light" : "dark");
      html.dataset.titleTheme =
        themed?.dataset.titleTheme ?? html.dataset.sidebarTheme;

      const active = sections
        .filter((section) => {
          const rect = section.getBoundingClientRect();
          return (
            rect.top <= window.innerHeight * 0.55 &&
            rect.bottom > window.innerHeight * 0.55
          );
        })
        .at(-1);
      const activeId = active?.dataset.sectionId;
      if (activeId) {
        for (const item of document.querySelectorAll(
          "aside li.sidebar-link-active"
        )) {
          item.classList.remove("sidebar-link-active");
        }
        const link = document.querySelector<HTMLAnchorElement>(
          `aside a[href$="#${CSS.escape(activeId)}"]`
        );
        link?.closest("li")?.classList.add("sidebar-link-active");
      }
    };

    let scrollFrame = 0;
    const onScroll = () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(updateScrollState);
    };
    updateScrollState();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    const viewable = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-viewable-component="true"]'
      )
    );
    const mediaObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setMediaVisible(entry.target);
          mediaObserver.unobserve(entry.target);
        }
      },
      { rootMargin: "100% 0px" }
    );
    viewable.forEach((element) => mediaObserver.observe(element));

    const videos = Array.from(document.querySelectorAll("video"));
    for (const video of videos) {
      video.muted = true;
      video.playsInline = true;
    }
    const videoObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const video = entry.target as HTMLVideoElement;
          if (entry.isIntersecting) {
            void video.play().catch(() => undefined);
          } else {
            video.pause();
          }
        }
      },
      { rootMargin: "50% 0px" }
    );
    videos.forEach((video) => videoObserver.observe(video));

    const cleanupInteractions: Array<() => void> = [];
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    // Recreate the authored Sidekick app cloud. The captured HTML contains
    // the source's pre-entry half-scale/transparent inline styles, so without
    // hydration these cards otherwise remain permanently hidden.
    const cloudCards = Array.from(
      document.querySelectorAll<HTMLElement>(".cloud-card")
    );
    const cloudInteractive = cloudCards.filter((card) =>
      card.classList.contains("cloud-card-interactive")
    );
    const cloudParallax = cloudCards.filter((card) =>
      card.classList.contains("cloud-card-parallax")
    );
    const cloudRoot = cloudCards[0]?.parentElement;
    const cloudAnimations = new Set<Animation>();
    const revealCloudCard = (card: HTMLElement) => {
      if (card.dataset.cloudEntered === "true") return;
      card.dataset.cloudEntered = "true";
      const baseScale = Number(card.dataset.baseScale ?? 1);
      const baseOpacity = Number(card.dataset.baseOpacity ?? 1);
      const settle = () => {
        card.style.transform = `translate3d(0px, 0px, 0px) scale(${baseScale})`;
        card.style.opacity = String(baseOpacity);
      };

      if (reducedMotion) {
        settle();
        return;
      }

      const animation = card.animate(
        [
          {
            transform: `translate3d(0px, 0px, 0px) scale(${baseScale * 0.5})`,
            opacity: 0,
          },
          {
            transform: `translate3d(0px, 0px, 0px) scale(${baseScale})`,
            opacity: baseOpacity,
          },
        ],
        {
          duration: 1_000,
          delay: Math.random() * 800,
          easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
          fill: "forwards",
        }
      );
      cloudAnimations.add(animation);
      void animation.finished
        .then(() => {
          settle();
          animation.cancel();
          cloudAnimations.delete(animation);
        })
        .catch(() => undefined);
    };
    const cloudObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          cloudCards.forEach(revealCloudCard);
          cloudObserver.disconnect();
          break;
        }
      },
      { rootMargin: "25% 0px" }
    );
    if (cloudRoot) cloudObserver.observe(cloudRoot);

    let cloudFrame = 0;
    let cloudPointerX = 0;
    let cloudPointerY = 0;
    let cloudHasPointer = false;
    const renderCloudPointer = () => {
      cloudFrame = 0;
      if (!cloudRoot) return;
      const rootRect = cloudRoot.getBoundingClientRect();
      const normalizedX = cloudHasPointer
        ? (cloudPointerX - rootRect.left) / rootRect.width - 0.5
        : 0;
      const normalizedY = cloudHasPointer
        ? (cloudPointerY - rootRect.top) / rootRect.height - 0.5
        : 0;

      for (const card of cloudParallax) {
        if (card.dataset.cloudEntered !== "true") continue;
        const scale = Number(card.dataset.baseScale ?? 1);
        card.style.transform = `translate3d(${normalizedX * -15}px, ${
          normalizedY * -15
        }px, 0) scale(${scale})`;
      }

      for (const card of cloudInteractive) {
        if (card.dataset.cloudEntered !== "true") continue;
        const scale = Number(card.dataset.baseScale ?? 1);
        let x = 0;
        let y = 0;
        if (cloudHasPointer) {
          const rect = card.getBoundingClientRect();
          const dx = rect.left + rect.width / 2 - cloudPointerX;
          const dy = rect.top + rect.height / 2 - cloudPointerY;
          const distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < 300) {
            const falloff = 1 - (distance / 300) ** 2;
            x = (dx / distance) * 20 * falloff;
            y = (dy / distance) * 20 * falloff;
          }
        }
        card.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
      }
    };
    const scheduleCloudPointer = () => {
      if (!cloudFrame) cloudFrame = requestAnimationFrame(renderCloudPointer);
    };
    const onCloudPointerMove = (event: PointerEvent) => {
      cloudHasPointer = true;
      cloudPointerX = event.clientX;
      cloudPointerY = event.clientY;
      scheduleCloudPointer();
    };
    const onCloudPointerLeave = () => {
      cloudHasPointer = false;
      scheduleCloudPointer();
    };
    cloudRoot?.addEventListener("pointermove", onCloudPointerMove);
    cloudRoot?.addEventListener("pointerleave", onCloudPointerLeave);
    cleanupInteractions.push(() => {
      cancelAnimationFrame(cloudFrame);
      cloudObserver.disconnect();
      cloudAnimations.forEach((animation) => animation.cancel());
      cloudAnimations.clear();
      cloudRoot?.removeEventListener("pointermove", onCloudPointerMove);
      cloudRoot?.removeEventListener("pointerleave", onCloudPointerLeave);
    });

    const editionsButton = document.querySelector<HTMLButtonElement>(
      '[data-component-name="all-editions-dropdown"]'
    );
    const editionsPanel = document.getElementById(
      "all-editions-dropdown-expandable-section"
    );
    if (editionsButton && editionsPanel) {
      const toggleEditions = () => {
        const open = editionsButton.getAttribute("aria-expanded") !== "true";
        editionsButton.setAttribute("aria-expanded", String(open));
        editionsPanel.setAttribute("aria-hidden", String(!open));
        Object.assign(editionsPanel.style, {
          visibility: open ? "visible" : "hidden",
          opacity: open ? "1" : "0",
          pointerEvents: open ? "auto" : "none",
          transform: open ? "translateY(0)" : "",
        });
      };
      editionsButton.addEventListener("click", toggleEditions);
      cleanupInteractions.push(() =>
        editionsButton.removeEventListener("click", toggleEditions)
      );
    }

    const menuButton = document.querySelector<HTMLButtonElement>(
      'button[aria-controls="mobile-menu"]'
    );
    const mobileMenu = document.getElementById("mobile-menu");
    if (menuButton && mobileMenu) {
      const toggleMenu = () => {
        const open = menuButton.getAttribute("aria-expanded") !== "true";
        menuButton.setAttribute("aria-expanded", String(open));
        mobileMenu.style.gridTemplateRows = open ? "1fr" : "0fr";
      };
      menuButton.addEventListener("click", toggleMenu);
      cleanupInteractions.push(() =>
        menuButton.removeEventListener("click", toggleMenu)
      );
    }

    const videoIds: Record<string, string> = {
      "sidekick-video": "LU4tghjdnG8",
      "agentic-storefronts-video": "22NqvJyppt8",
      "tinker-app": "k7XydEQQniY",
      "shopify-product-network": "ydtWlMuDuT8",
      "build-with-full-mcp-support": "ydtWlMuDuT8",
    };
    const videoModal = document.querySelector<HTMLElement>(
      '[data-component-name="video-modal"]'
    );
    const videoWrap =
      videoModal?.querySelector<HTMLElement>(".video-wrap") ?? null;
    const videoLaunchers = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-component-name="cta-open-video-modal"]'
      )
    );
    let lastVideoLauncher: HTMLButtonElement | null = null;
    let previousBodyOverflow = "";
    const closeVideoModal = () => {
      if (!videoModal) return;
      videoModal.classList.add("hidden");
      videoModal.dataset.componentExtraProductHandle = "";
      videoModal.querySelector("iframe")?.remove();
      document.body.style.overflow = previousBodyOverflow;
      lastVideoLauncher?.focus({ preventScroll: true });
      lastVideoLauncher = null;
    };
    const onVideoKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !videoModal?.classList.contains("hidden")) {
        closeVideoModal();
      }
    };
    if (videoModal && videoWrap) {
      for (const launcher of videoLaunchers) {
        const openVideoModal = () => {
          const transitionId = launcher.dataset.transitionId ?? "";
          const youtubeId = videoIds[transitionId];
          if (!youtubeId) return;

          videoModal.querySelector("iframe")?.remove();
          const iframe = document.createElement("iframe");
          iframe.className =
            "youtube size-full top-0 left-0 absolute self-center bg-black";
          iframe.src = `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0&start=0`;
          iframe.title = launcher
            .closest<HTMLElement>("article")
            ?.querySelector("h2, h3, h4")
            ?.textContent?.trim() ?? "Bea Sophia video";
          iframe.allow =
            "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture";
          iframe.allowFullscreen = true;
          videoWrap.append(iframe);

          lastVideoLauncher = launcher;
          previousBodyOverflow = document.body.style.overflow;
          document.body.style.overflow = "hidden";
          videoModal.dataset.componentExtraProductHandle = transitionId;
          videoModal.setAttribute(
            "aria-labelledby",
            `card-heading-${transitionId}`
          );
          videoModal.classList.remove("hidden");
          videoModal
            .querySelector<HTMLButtonElement>(
              '[data-component-name="modal-close"]'
            )
            ?.focus({ preventScroll: true });
        };
        launcher.addEventListener("click", openVideoModal);
        cleanupInteractions.push(() =>
          launcher.removeEventListener("click", openVideoModal)
        );
      }

      const modalCloseButtons = Array.from(
        videoModal.querySelectorAll<HTMLButtonElement>(
          '[data-component-name="modal-close"], button[aria-hidden="true"]'
        )
      );
      modalCloseButtons.forEach((button) =>
        button.addEventListener("click", closeVideoModal)
      );
      document.addEventListener("keydown", onVideoKeyDown);
      cleanupInteractions.push(() => {
        modalCloseButtons.forEach((button) =>
          button.removeEventListener("click", closeVideoModal)
        );
        document.removeEventListener("keydown", onVideoKeyDown);
        videoModal.querySelector("iframe")?.remove();
        document.body.style.overflow = previousBodyOverflow;
      });
    }

    return () => {
      cancelAnimationFrame(scrollFrame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      mediaObserver.disconnect();
      videoObserver.disconnect();
      cleanupInteractions.forEach((cleanup) => cleanup());
    };
  }, []);

  return null;
}
