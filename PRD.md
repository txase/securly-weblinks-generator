# Securly Web Links Generator PRD

## Summary

This product is a Chrome extension that helps teachers generate Securly Web Links for classroom allow lists. A teacher starts a recording session, navigates through the school's entry point and the target service, stops recording, and receives a proposed Securly `Site` value plus a list of `Dependencies` derived from observed browser requests and analyzed by Google Gemini.

The extension is intended to reduce the manual effort of discovering all required domains and paths for a service such as Canvas, including vanity domains, SSO redirects, asset hosts, API endpoints, and other supporting dependencies.

Version 1 is a Chrome-extension-only workflow. It does not directly integrate with Securly. The final output is a read-only result screen that the teacher manually copies into the Securly admin dashboard.

## Problem Statement

Teachers and school administrators often need to create narrow allow lists in Securly so students can access a single instructional service while other sites remain blocked. In practice, enabling a service requires more than its primary domain. The full flow may depend on:

- a school district dashboard or launcher site
- district-specific vanity domains
- first-party service domains
- SSO and redirect domains
- third-party asset hosts used for scripts, styles, fonts, images, and XHR or fetch traffic

Determining the correct dependency list manually is time-consuming and error-prone. It also requires judgment about specificity. Some dependencies should be expressed as wildcard domains such as `*.canvas.com`, while others should remain fully qualified such as a specific `cloudfront.net` host. This choice cannot be determined reliably through simple rules alone.

## Goals

- Let a teacher record a browser session that captures the network activity required to reach and use a target service.
- Extract and normalize relevant domains and paths from the recorded session.
- Send the normalized session data to Gemini for dependency analysis and recommendation.
- Return a proposed Securly `Site` value and a list of `Dependencies`.
- Make the output easy to copy into Securly with minimal manual formatting.

## Non-Goals

- Direct creation or editing of Web Links inside Securly
- Shared cloud storage, collaboration, or multi-user workflows
- Support for AI providers other than Gemini in v1
- Long-term retention of recorded browsing sessions
- In-extension editing of Gemini's proposed output in v1
- Automated guarantees that the generated allow list is complete or correct for every environment

## Users

Primary user:

- teachers or school staff responsible for configuring or requesting Securly Web Links

Secondary user:

- technically inclined staff validating whether a recorded session contains the expected dependencies

## Core User Story

As a teacher, I want to record the browser activity needed to access a learning service and receive a proposed Securly Web Link configuration, so I can create an allow list faster and with fewer missed dependencies.

## User Workflow

1. The teacher opens the Chrome extension.
2. The extension shows an idle state and indicates that recording is not active.
3. The teacher clicks `Start Recording`.
4. The extension clearly indicates that recording is active.
5. The teacher navigates through the required flow, such as a district dashboard, SSO steps, the target product, and any pages whose functionality must be allowed.
6. The teacher clicks `Stop Recording`.
7. The extension summarizes that the recording is complete and prepares data for analysis.
8. If a Gemini API key is not configured, the extension prompts the teacher to provide one before analysis can continue.
9. The extension sends the normalized session data to Gemini.
10. Gemini returns a proposed `Site` value and a list of `Dependencies`.
11. The extension presents the results in a read-only review screen with copy actions.
12. The teacher copies the values and manually enters them in the Securly dashboard.

## Functional Requirements

### Recording

- The extension must only record browser request activity after the teacher explicitly starts a recording session.
- The extension must stop recording immediately when the teacher explicitly ends the session.
- The extension must provide a visible recording state so the teacher knows whether capture is active.
- The extension must support recording a multi-step navigation flow across multiple domains.
- The extension must capture enough request information to derive domain and path candidates for Securly analysis.

### Captured Data

For each captured request, the system must retain at least:

- full request URL
- derived hostname
- path component when present
- request timing metadata sufficient to preserve session ordering
- request classification metadata when available through Chrome APIs, such as request type

The system may capture additional request metadata if needed for analysis, but v1 should minimize data collection to what is useful for generating the Web Link output.

### Normalization

- The extension must normalize the recorded request set into analysis-ready candidates before sending data to Gemini.
- The normalization step must deduplicate obvious duplicates while preserving enough context to distinguish significant paths.
- The normalization step must preserve both domain-level and optional path-level candidates because some Securly entries may need path specificity.
- The normalization step must not attempt to algorithmically decide wildcard versus fully qualified specificity as a final rule. That judgment belongs to Gemini in v1.

### Gemini Analysis

- Gemini is the only AI provider supported in v1.
- The extension must call Gemini directly using a teacher-supplied API key stored in extension settings.
- The Gemini request must include only the normalized data needed to infer a proposed `Site` value and `Dependencies`.
- The expected Gemini response must contain:
  - one `site` string
  - one `dependencies` array of strings
- The extension may use an internal rationale or debugging field during development, but rationale is not required in the teacher-facing v1 experience.

### Results

- The extension must present Gemini's output in a read-only results view.
- The results view must display:
  - the proposed Securly `Site` value
  - the proposed `Dependencies` list
- The extension must provide copy actions so the teacher can copy the `Site` value and the dependencies output.
- The extension must make clear that the output is intended for manual review and entry in Securly.
- The extension must not allow direct editing of the output within the extension in v1.

### Settings

- The extension must provide a way for the teacher to enter and update a Gemini API key.
- The API key must be stored locally in Chrome extension storage.
- The extension must block analysis and show a clear message if no API key is configured.

### Error Handling

The extension must provide clear error states for:

- no recording in progress when the teacher expects capture
- recording stopped with no useful requests captured
- missing Gemini API key
- invalid Gemini API key or failed Gemini authentication
- Gemini request failure or timeout
- Gemini response that is missing required fields or cannot be parsed into the expected structure

## UX Requirements

- The extension UI must be simple enough for a teacher to use without technical expertise.
- The recording state must be obvious at all times.
- The user should be guided through a linear flow: idle, recording, ready for analysis, analyzing, results, or error.
- The results screen should be optimized for fast copy/paste into Securly rather than deep inspection or editing.
- The UX should communicate that broader browsing outside the intended target flow may introduce extra dependencies, so users should record deliberately.

## Privacy And Security Requirements

- Recording must only occur during an explicitly user-initiated session.
- Recorded session data must be ephemeral and cleared when the flow completes, is canceled, or the extension session is abandoned.
- The product must not store historical browsing sessions for later retrieval in v1.
- The product must disclose that captured request-derived domain and path data is sent to Gemini for analysis.
- The product should minimize the amount of captured data sent to Gemini and avoid sending unnecessary request details.
- The Gemini API key must remain local to the extension and must not be transmitted anywhere except the Gemini API request flow.

## Technical Constraints

- The extension target is Chrome desktop.
- The extension should be designed for Chrome Manifest V3.
- Request observation should rely on Chrome extension APIs rather than site-specific instrumentation unless a concrete limitation is discovered during implementation.
- The system should handle typical school authentication and redirect flows that span multiple domains.

## Success Metrics

Success for v1 will be measured qualitatively rather than through analytics instrumentation.

The product is successful if:

- a teacher can complete the end-to-end workflow without engineering support
- the extension produces a plausible `Site` and dependency list for a representative service flow such as Canvas
- the generated output reduces the time and manual guesswork needed to create a Securly Web Link

## Acceptance Criteria

### Happy Path

- A teacher starts recording, navigates through a real service flow, stops recording, runs Gemini analysis, and receives a proposed `Site` value and `Dependencies` list.
- The teacher can copy both outputs and manually paste them into Securly.

### Capture Coverage

- A recorded session that includes redirects, asset loading, and API calls produces normalized candidates for Gemini.
- The output includes dependencies beyond the obvious top-level site when such dependencies are required by the recorded flow.

### Failure Scenarios

- If no Gemini API key is configured, the extension prevents analysis and tells the teacher how to add the key.
- If recording yields no useful traffic, the extension tells the teacher to retry with a more complete navigation flow.
- If Gemini fails or returns malformed output, the extension shows an error rather than incomplete or misleading results.

### Data Handling

- Recorded session data is not retained after the session is completed or abandoned.
- The extension never records traffic unless the teacher explicitly initiated recording.

## Risks And Limitations

- Gemini may overgeneralize or undergeneralize domain specificity.
- Some captured requests may reflect incidental browsing noise rather than required service dependencies.
- School-specific authentication flows may vary enough that results are environment-dependent.
- Because results are read-only in v1, any refinement must happen manually after copying into Securly.
- Securly's own validation and behavior remain outside the extension's control.

## Future Considerations

These are explicitly outside v1 but may be considered later:

- editable results before copy/paste
- session comparison across multiple recordings
- export helpers or structured output formats
- provider abstraction beyond Gemini
- direct integration with Securly or admin tooling
- shared templates for common education services
