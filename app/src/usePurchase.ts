import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { ApiError, checkout, devSettle, paymentStatus } from "./api";

/** Check the existing charge while approval is pending. Checkout also reuses
 * pending purchases server-side, including after a restart or network timeout. */
export function usePurchase(type: "video_unlock" | "live_ticket", targetId: string, amountUgx: number, onOwned: () => void) {
  const [buying, setBuying] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const buy = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBuying(true);
    try {
      const purchase = await checkout(type, targetId);
      if (purchase.simulated) await devSettle(purchase.txRef, amountUgx);
      else if (mounted.current) Alert.alert("Check your phone", "Approve the Mobile Money prompt. We’ll check your payment automatically.");
      for (let attempt = 0; attempt < 20 && mounted.current; attempt++) {
        const result = await paymentStatus(purchase.transactionId);
        if (!mounted.current) return;
        if (result.owned) { onOwned(); return; }
        if (result.status === "failed" || result.status === "refunded") {
          throw new Error("Payment was unsuccessful. You can try again.");
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 3000));
      }
      if (mounted.current) Alert.alert("Payment pending", "Tap again to check this payment. Your pending purchase will be reused.");
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ApiError && error.code === "already_owned") onOwned();
      else if (error instanceof ApiError && error.code === "already_paid") {
        Alert.alert("Access unavailable", "This purchase has already been paid. Refresh the item or contact support.");
      } else Alert.alert("Payment status", error instanceof Error ? error.message : "Try checking again");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBuying(false);
    }
  };
  return { buying, buy };
}
