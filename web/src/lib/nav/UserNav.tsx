"use client";

// Dual-mode navigation host for the user app.
//  - browser: renders the initial screen; navigation goes through the Next
//    router (real URLs, deep links, history).
//  - embedded (Telegram/Bale webview): in-memory stack only — no pushState —
//    and the host BackButton pops the stack (Bale's iframe requires this).
// Route files are thin wrappers: <UserNav initial="home" /> etc.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMiniApp, useBackButton } from "@/lib/miniapp/useMiniApp";
import {
  createNavStack,
  currentScreen,
  popScreen,
  pushScreen,
  USER_SCREENS,
  type NavStack,
  type ScreenKey,
} from "@/lib/nav/userNav";
import HomeScreen from "@/components/screens/HomeScreen";
import ChatScreen from "@/components/screens/ChatScreen";
import BillsScreen from "@/components/screens/BillsScreen";
import ProfileScreen from "@/components/screens/ProfileScreen";

export interface UserNavValue {
  screen: ScreenKey;
  embedded: boolean;
  go: (key: ScreenKey) => void;
}

import { createContext, useContext } from "react";

const UserNavContext = createContext<UserNavValue>({
  screen: "home",
  embedded: false,
  go: () => {},
});

export function useUserNav(): UserNavValue {
  return useContext(UserNavContext);
}

export function UserNav({ initial }: { initial: ScreenKey }) {
  const { host } = useMiniApp();
  const router = useRouter();
  const embedded = host !== "browser";
  // Kept even in browser mode so useUserNav consumers see a live screen key.
  const [stack, setStack] = useState<NavStack>(() => createNavStack(initial));

  const go = useCallback(
    (key: ScreenKey) => {
      if (embedded) {
        setStack((s) => pushScreen(s, key));
      } else {
        const href = USER_SCREENS.find((sc) => sc.key === key)?.href;
        if (href) router.push(href);
      }
    },
    [embedded, router],
  );

  const canBack = embedded && stack.stack.length > 1;
  const back = useCallback(() => {
    setStack((s) => popScreen(s) ?? s);
  }, []);
  useBackButton(back, { visible: canBack });

  // Keep the context's screen key in sync with real routing in browser mode
  // (route files remount UserNav per navigation; initial reflects the URL).
  useEffect(() => {
    if (!embedded) setStack(createNavStack(initial));
  }, [initial, embedded]);

  const value = useMemo<UserNavValue>(
    () => ({ screen: currentScreen(stack), embedded, go }),
    [stack, embedded, go],
  );

  const screen = value.screen;
  return (
    <UserNavContext.Provider value={value}>
      {screen === "home" && <HomeScreen />}
      {screen === "chat" && <ChatScreen />}
      {screen === "bills" && <BillsScreen />}
      {screen === "profile" && <ProfileScreen />}
    </UserNavContext.Provider>
  );
}
