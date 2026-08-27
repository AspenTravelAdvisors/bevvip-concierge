// /bucket-list — everything the traveler has kept, across all seven collections.
//
// The product is named for this page and, until now, did not have it. A visitor
// could browse 2,382 hotels, 3,542 sailings and 3,902 villas and had no way to
// say "this one" about any of them; the closest thing to a list was whatever
// the last search returned, which vanished on the next question.
//
// Server component for the shell and the metadata only. The list itself lives
// in localStorage (lib/bucket-list) and so cannot be rendered on the server —
// see the client component for what that costs and why it is still right.

import type { Metadata } from "next";
import BucketList from "@/components/BucketList";
import { SITE_URL } from "@/lib/answers";

export const metadata: Metadata = {
  title: "Your Bucket List — Expedition Bucket List",
  description:
    "Everything you've kept from the atlas — hotels, expedition sailings, villas, world cruises, rail journeys and private jet expeditions — in one list an Aspen Travel Advisors specialist can price.",
  alternates: { canonical: `${SITE_URL}/bucket-list` },
  // Nothing here is public: the page renders one visitor's own localStorage, so
  // to a crawler it is a permanently empty page. Keeping it out of the index
  // stops it competing with /answers for the brand's own name.
  robots: { index: false, follow: true },
};

export default function BucketListPage() {
  return <BucketList />;
}
