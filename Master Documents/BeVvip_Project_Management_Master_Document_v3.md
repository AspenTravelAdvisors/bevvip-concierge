# BeVvip Project Management Master Document

## Plain-English Project Brief

**What the app does**  
Acts as a luxury-only travel concierge for hotels, villas, cruises, tours, and select high-end experiences. It helps users discover the best value within luxury, frames VIP benefits and planning-range pricing when needed, and moves them toward the right next step: self-serve browsing, BeVvip brand handoff, or direct advisor outreach.

**Stack being used**  
Custom GPT instructions for the ChatGPT version. Standalone web app deployed on Vercel. Front end is largely a single static HTML/CSS/JavaScript page in `public/index.html`. Backend is a Node-based Vercel serverless function at `api/chat.js` that proxies requests to the OpenAI chat completions API. Google Maps, Places, and Street View are used for hotel discovery and map presentation.

**Current URLs**  
- Custom GPT: https://chatgpt.com/g/g-69c57cf49b408191a40d144031263b52-luxury-travel-vip-perks-aspen-travel-advisors
- Standalone app primary: https://bevvip-concierge.vercel.app
- Standalone app secondary / deployment URL: https://bevvip-concierge-b66yh9i6z-aspentraveladvisors-projects.vercel.app
- Repository: https://github.com/AspenTravelAdvisors/bevvip-concierge
- Hotel booking/search path: VipTravelAi.com (password = VIP)
- Experiences / tours / cruises landing path: https://www.virtuoso.com/advisor/brianharris
- Advisor / brand handoff paths: BeVvip.com and Book@BeVvip.com

**Major features**  
- Luxury travel chat interface
- Recommendation generation
- Preferred-partner and Virtuoso-aligned positioning
- Booking-link token generation
- Hidden `BEVVIP_HOTELS` payload parsing
- Interactive hotel map
- Hotel cards
- Street View and photo enrichment
- Mobile tab experience
- Advisor / white-glove CTA structure

**What is working**  
- Clear luxury positioning and consistent premium brand voice
- Working Vercel deployment pattern
- Functional `api/chat` proxy to OpenAI
- Prompt logic that can generate Virtuoso booking tokens
- Front-end parsing for hidden hotel tags that can drive map and hotel-card rendering
- Updated Custom GPT strategy that better matches the intended business model: luxury-only qualification, value-within-luxury framing, and cleaner routing into search or advisor handoff

**What is broken**  
- The Custom GPT and the standalone app still do not obey the same business rules in practice
- The Custom GPT has now been revised toward discovery, qualification, and routing, but the standalone app may still reflect older prompt assumptions
- The app still relies on fragile model formatting, markdown tables, tokens, and hidden JSON-like tags
- There is no real supplier API, Virtuoso API, booking engine integration, CRM, advisor-handoff workflow, auth, durable session state, or analytics pipeline
- Lead capture and advisor routing are still more of a CTA than a complete operational system

**What matters most next**  
Create one source of truth for business logic, not one identical experience across surfaces. The Custom GPT should function as a discovery and qualification concierge inside ChatGPT, while the standalone app should function as the more structured conversion layer with cleaner formatting, lead capture, and advisor handoff. Then define a shared rule set for recommendation standards, pricing disclosure, partner and perks language, escalation triggers, and success metrics so the two experiences stay strategically aligned without becoming clones. From there, stabilize the app’s output contract, add lead capture and advisor routing to BeVvip.com and Book@BeVvip.com, define analytics, and connect recommendations to real inventory, advisor operations, or both.

## Architecture Notes

### Current product surfaces
1. **Custom GPT**
   - Runs inside ChatGPT
   - Controlled mainly through long-form prompt instructions
   - Now positioned as a luxury-only discovery and qualification surface

2. **Standalone app**
   - Deployed on Vercel
   - Static front end with a single Node serverless chat endpoint
   - Uses Google Maps, Places, and Street View
   - Should become the more structured conversion surface

3. **Important alignment principle**
   - The two surfaces should share one business brain, not one identical user experience
   - Shared elements should include brand promise, luxury threshold, recommendation rules, pricing disclosure logic, value framing, and handoff triggers
   - Surface-specific differences can include tone, pacing, output format, and how aggressively each flow pushes toward conversion

### Current standalone app flow
1. User enters a query in the browser chat UI
2. Front end posts messages to `/api/chat`
3. Vercel function prepends a large system prompt and calls OpenAI chat completions with model `gpt-4.1`
4. Response streams back to the browser
5. Front end expands `VHOTEL` / `VCRUISE` / `VTOUR` tokens into booking links
6. Front end parses the hidden `BEVVIP_HOTELS` payload and uses Google services to enrich and render map results

### Current Custom GPT flow
1. User discovers or opens the Custom GPT inside ChatGPT
2. GPT asks up to a few qualification questions as needed
3. GPT narrows to true-luxury, Virtuoso-aligned, or preferred-partner options
4. GPT frames recommendations around value within luxury rather than cheapest price
5. GPT routes the user toward the correct next step:
   - continue in chat
   - browse hotel inventory on VipTravelAi.com (password = VIP)
   - browse experiences, tours, or cruises through the Brian Harris Virtuoso page
   - hand off to BeVvip.com or Book@BeVvip.com for advisor-led planning

### Known architecture issues
- No shared canonical rules file or behavior spec between GPT and app
- No structured backend schema returning machine-safe JSON plus human-readable prose
- No persistence layer for users, sessions, saved trips, or lead records
- No CRM or advisor-routing sink
- No analytics or observability layer
- No real-time availability, pricing, or supplier inventory connection
- Heavy dependence on prompt formatting rather than application contracts
- No formal distinction in code yet between exploratory, structured-shopper, and high-touch routing paths

### Recommended target architecture
- One canonical business-rules document or config shared across all surfaces
- Front end broken into maintainable components instead of one large HTML file
- Backend orchestration layer that returns both structured JSON and rendered narrative text
- Lightweight database for sessions, leads, preferences, and event logs
- Dedicated advisor handoff flow feeding BeVvip.com and Book@BeVvip.com
- Analytics on prompts, clicks, map interactions, VipTravelAi click-outs, Virtuoso click-outs, and handoff conversions
- Future supplier or booking integrations only after the behavior contract is stable

## What Is Still Missing

These are the remaining gaps that would materially improve the master document and make the project easier to manage:

- **Production decision**: which Vercel URL is the intended production URL, and whether a custom domain will sit on top of it
- **Source of truth**: a short rules spec that both the Custom GPT and app must follow so they stop diverging
- **Environment inventory**: which secrets are in use now besides `OPENAI_API_KEY` and Google keys, and where each one is stored
- **Advisor handoff implementation**: whether BeVvip.com and Book@BeVvip.com are just destinations today or part of a structured capture workflow
- **Analytics target**: what success means in practice: VipTravelAi clicks, Virtuoso clicks, advisor emails, form fills, or completed bookings
- **Model policy**: whether `gpt-4.1` remains the intended model, and how model changes will be tested and approved
- **Error handling policy**: what the app should do when the model output is malformed, token links fail, maps fail, or no valid hotel payload is returned
- **Roadmap owner**: who owns prompt logic, code changes, deployment, copy, and advisor workflow decisions

## Priority Order

1. Lock the shared business logic between Custom GPT and standalone app
2. Update the standalone app prompt and response contract to match the new GPT strategy
3. Stabilize code structure and output contracts
4. Implement real lead capture and advisor handoff
5. Add analytics and observability
6. Connect real travel data and booking or inventory systems
