# BeVvip Project Management Master Document

## Plain-English Project Brief

**What the app does**  
Acts as a luxury travel concierge for hotels, villas, cruises, tours, and private jet journeys. It recommends preferred-partner style options, frames VIP benefits and estimated pricing, and tries to move the user toward either a booking link or advisor handoff.

**Stack being used**  
Custom GPT instructions for the ChatGPT version. Standalone web app deployed on Vercel. Front end is largely a single static HTML/CSS/JavaScript page in `public/index.html`. Backend is a Node-based Vercel serverless function at `api/chat.js` that proxies requests to the OpenAI chat completions API. Google Maps, Places, and Street View are used for hotel discovery and map presentation.

**Current URLs**  
- Custom GPT: https://chatgpt.com/g/g-69c57cf49b408191a40d144031263b52-luxury-travel-vip-perks-aspen-travel-advisors
- Standalone app primary: https://bevvip-concierge.vercel.app
- Standalone app secondary / deployment URL: https://bevvip-concierge-b66yh9i6z-aspentraveladvisors-projects.vercel.app
- Repository: https://github.com/AspenTravelAdvisors/bevvip-concierge
- Referenced brand and booking destinations in logic: BeVvip.com, VipTravelAi.com, Virtuoso advisor links under brianharris

**Major features**  
- Luxury travel chat interface
- Recommendation generation
- Virtuoso-style benefit framing
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

**What is broken**  
- The Custom GPT and the standalone app do not obey the same product rules
- The Custom GPT is written as a browse-first, live-rate concierge when dates are provided
- The standalone app explicitly says browsing is unavailable and relies on estimate-only behavior
- There is no real supplier API, Virtuoso API, booking engine integration, CRM, advisor-handoff workflow, auth, durable session state, or analytics pipeline
- Core UI behavior is still fragile because it depends on the model emitting exact formatting, markdown tables, tokens, and hidden JSON-like tags

**What matters most next**  
First, create one source of truth for product behavior and decide whether this product is mainly a lead-generation concierge or a true booking workflow. Then stabilize the response contract, add lead capture and advisor handoff, define analytics, and connect recommendations to real inventory, advisor operations, or both.

## Architecture Notes

### Current product surfaces
1. **Custom GPT**
   - Runs inside ChatGPT
   - Controlled mainly through long-form prompt instructions

2. **Standalone app**
   - Deployed on Vercel
   - Static front end with a single Node serverless chat endpoint
   - Uses Google Maps, Places, and Street View

3. **Important mismatch**
   - The two surfaces currently share brand intent but not the same operating behavior

### Current standalone app flow
1. User enters a query in the browser chat UI
2. Front end posts messages to `/api/chat`
3. Vercel function prepends a large system prompt and calls OpenAI chat completions with model `gpt-4.1`
4. Response streams back to the browser
5. Front end expands `VHOTEL` / `VCRUISE` / `VTOUR` tokens into booking links
6. Front end parses the hidden `BEVVIP_HOTELS` payload and uses Google services to enrich and render map results

### Known architecture issues
- No shared canonical rules file or behavior spec between GPT and app
- No structured backend schema returning machine-safe JSON plus human-readable prose
- No persistence layer for users, sessions, saved trips, or lead records
- No CRM or advisor-routing sink
- No analytics or observability layer
- No real-time availability, pricing, or supplier inventory connection
- Heavy dependence on prompt formatting rather than application contracts

### Recommended target architecture
- One canonical product rules document or config shared across all surfaces
- Front end broken into maintainable components instead of one large HTML file
- Backend orchestration layer that returns both structured JSON and rendered narrative text
- Lightweight database for sessions, leads, preferences, and event logs
- Advisor handoff form with email or CRM integration
- Analytics on prompts, clicks, map interactions, profile unlock clicks, and handoff conversions
- Future supplier or booking integrations only after the behavior contract is stable

## What Is Still Missing

These are the remaining gaps that would materially improve the master document and make the project easier to manage:

- **Production decision**: which Vercel URL is the intended production URL, and whether a custom domain will sit on top of it
- **Source of truth**: a short rules spec that both the Custom GPT and app must follow so they stop diverging
- **Environment inventory**: which secrets are in use now besides `OPENAI_API_KEY` and Google keys, and where each one is stored
- **Advisor handoff destination**: where leads should actually go today: email only, form, CRM, spreadsheet, or another system
- **Analytics target**: what success means in practice: booking-link clicks, advisor emails, profile unlocks, form fills, or completed bookings
- **Model policy**: whether `gpt-4.1` remains the intended model, and how model changes will be tested and approved
- **Error handling policy**: what the app should do when the model output is malformed, token links fail, maps fail, or no valid hotel payload is returned
- **Roadmap owner**: who owns prompt logic, code changes, deployment, copy, and advisor workflow decisions

## Priority Order

1. Converge Custom GPT and standalone app behavior
2. Lock the product brief and operating rules
3. Stabilize code structure and output contracts
4. Add lead capture and advisor handoff
5. Add analytics and observability
6. Connect real travel data and booking or inventory systems
