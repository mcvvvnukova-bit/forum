# Construction Order Distribution Platform

This context describes a platform for distributing construction work packages in Russia, especially around state and large corporate contracts.

## Language

**Customer Company**:
A small or medium construction company that performs state contracts or contracts for large corporate clients and uses the platform to distribute part of that work to external performers.
_Avoid_: End customer, private client, homeowner

**Single Participant Role**:
In the MVP, one registered organization account cannot act as both Customer Company and Provider. A company that needs both roles must register separate accounts and pass separate moderation for each role.
_Avoid_: Hybrid account, shared customer-provider account

**Customer Verification**:
Manual review of a registered Customer Company by a Moderator before it can publish Construction Orders or use core ordering functionality.
_Avoid_: Self-service customer activation, optional check

**Customer Registration Data**:
The MVP data required for Customer Company registration: company name, INN, legal form, region, contact person's full name and position, email, phone, password, and verification documents.
_Avoid_: Public customer profile, optional onboarding

**Verified Customer Company**:
A Customer Company that has passed Customer Verification and is allowed to publish Construction Orders and use relevant platform functionality.
_Avoid_: Registered customer, public buyer

**Заказчик**:
Пользовательская роль Customer Company в MVP. Заказчик управляет профилем компании, загружает сметы, редактирует Construction Orders, утверждает Lots, отвечает на Lot Comments и выбирает Offers.
_Avoid_: Менеджер заказов, procurement specialist

**Customer Company Users**:
Multiple users can belong to one Customer Company in the MVP. Customer Company users can have the Заказчик role or the Customer Organization Administrator role.
_Avoid_: Single-user company only

**Customer Organization Administrator**:
A Customer Company user role that manages users of the same Customer Company: invitations and deactivation. It does not add business approval powers beyond normal Заказчик access. Changing the Customer Organization Administrator requires a Customer Organization Administrator Change Request.
_Avoid_: Platform Administrator, Moderator

**Customer Organization Administrator Change Request**:
A request to a Moderator to change the Customer Organization Administrator after the first verified organization user is assigned automatically.
_Avoid_: Self-service ownership transfer, support-only informal change

**Customer User Invitation**:
An existing Customer Organization Administrator can invite another user to the same Customer Company by email. The invited user must confirm email, but the Customer Company does not repeat Customer Verification, and MVP invitations do not restrict email domains.
_Avoid_: Public join request, repeated company moderation, email domain restriction

**Customer User Deactivation**:
A Customer Organization Administrator can deactivate a Customer Company user to remove access while preserving created Projects, Construction Objects, Construction Orders, Lots, comments, history, and Audit Trail under the Customer Company. The author is shown as a deactivated user where needed.
_Avoid_: Hard delete, history removal

**Customer Work Filtering**:
MVP filtering for a Customer Company's Projects, Construction Objects, Construction Orders, and Lots by status, Project, Construction Object, Lot type, deadline, presence of Offers, winner-selection state, and moderation state.
_Avoid_: Global marketplace search, public provider search

**Customer Lot Metrics**:
MVP Customer Company metrics per Lot: number of Offers, Lot status, time remaining until offer deadline, and whether the winner has been selected.
_Avoid_: Customer BI dashboard, financial analytics

**Primary Contract**:
A state or large corporate construction contract held by a Customer Company before it decomposes part of the work into platform orders. A Primary Contract can be linked to a Project, but this link is optional.
_Avoid_: Lead, deal, generic order

**Project**:
A Customer Company workspace for a construction initiative. A Project can contain multiple Construction Objects and can optionally reference multiple Primary Contracts.
_Avoid_: Folder, contract in all cases, generic workspace

**Construction Object**:
A specific construction site, facility, building, section, or location inside a Project. A Construction Object can contain multiple Construction Orders.
_Avoid_: Project, address only, generic site

**Construction Order**:
An estimate-based order created by a Customer Company for a Construction Object. It can contain needs for materials, services, and equipment rental and is split into Lots for Providers.
_Avoid_: Single task, simple listing

**Imported Estimate**:
The original estimate file and structure uploaded by a Customer Company, preserved so the Customer Company can verify that the platform did not lose or distort the source document.
_Avoid_: Parsed data only, disposable upload

**Estimate Line**:
A line inside a Construction Order that describes one needed material, service, or equipment rental item with quantity, location, timing, and requirements.
_Avoid_: Generic item, product card

**Normalized Estimate Line**:
An Estimate Line interpreted into platform categories and fields such as request type, category, unit, quantity, object location, timing, requirements, and required documents.
_Avoid_: Original spreadsheet row, raw text

**Ambiguous Estimate Line**:
A Normalized Estimate Line that the platform could not classify confidently and must be clarified by a Customer Company or Moderator before it can be included in a Lot.
_Avoid_: Best guess, invalid row

**Lot**:
A smaller publishable package split from a Construction Order so performers can make targeted offers only for the Estimate Lines they can fulfill.
_Avoid_: Small order, generic request, full estimate

**Partial Fulfillment**:
The Customer Company-selected setting that allows a Provider to submit an Offer for only part of a Lot, allowing the Customer Company to combine several Offers into one winner-selection outcome.
_Avoid_: Incomplete offer, invalid response

**Visible Lot**:
A published Lot that matches a Verified Provider's Offer Profile and can be viewed by that Provider.
_Avoid_: Public order, full estimate access

**Visible Lot Filtering**:
MVP filtering for a Provider's Visible Lots by type, category, region, offer deadline, and whether the Provider has already submitted an Offer.
_Avoid_: Public search, provider directory search

**Provider Offer Metrics**:
MVP Provider metrics for submitted Offers: Offer submission date, related Lot status, and whether the Offer was selected as a winner.
_Avoid_: Competitive analytics, conversion dashboard

**Lot-Scoped Visibility**:
Providers can see only the information included in a Visible Lot. Project, Construction Object, Construction Order, Primary Contract, Customer Company, address, or other context is hidden unless it is explicitly included in the Lot.
_Avoid_: Inherited project visibility, full order context

**Lot-Provider Fit**:
The eligibility relationship between a Lot and a Verified Provider, based on offer type, category, region or service radius, required legal status and documents, and availability.
_Avoid_: Recommendation, ranking

**Lot Notification**:
A notification sent to a Verified Provider when a Published Lot becomes a Visible Lot for that Provider through Lot-Provider Fit. MVP notification channels are email, Telegram, and MAX messenger, selected by the Provider from the channels available on the platform.
_Avoid_: Broadcast to all providers, unfiltered marketing message

**Participant Notification Settings**:
The participant-selected notification channels available on the platform. MVP channels are email, Telegram, and MAX messenger for both Customer Companies and Providers.
_Avoid_: Forced channel, platform-only inbox, internal notification center

**Email Confirmation**:
MVP registration requires email confirmation before a participant can complete access to platform workflows.
_Avoid_: Unconfirmed email account, phone-only verification

**Email Password Recovery**:
MVP account recovery through a password reset flow sent to the user's confirmed email address.
_Avoid_: Manual support-only password reset

**Support Request**:
A simple MVP support form in the platform account that sends a message to the platform support email.
_Avoid_: Full helpdesk, support chat, ticket workflow

**Lot Suggestion**:
A platform-proposed grouping of Estimate Lines into a Lot that a Customer Company can approve, edit, or reject before publication.
_Avoid_: Automatic order, final lot

**Lot Disclosure**:
The platform-defined minimum set of Construction Order, Project, Construction Object, and estimate information included in a Lot for Providers to see. A Customer Company can edit a Lot before moderation, but cannot remove the minimum information required for Providers to prepare Offers.
_Avoid_: Customer-defined disclosure, inherited full context

**Lot Moderation**:
Manual review of a Lot by a Moderator before the Lot can be published on the platform.
_Avoid_: Immediate publication, automatic approval

**Moderation Rejection**:
A Moderator rejection of a participant, Lot, or review with a reason selected from Reference Data and a Moderator comment.
_Avoid_: Silent rejection, free-form-only rejection

**Published Lot**:
A Lot that has passed Lot Moderation and can become visible to fitting Verified Providers.
_Avoid_: Draft lot, public estimate

**Lot Lifecycle**:
The MVP state flow for a Lot: Draft, In Moderation, Published, Collecting Offers, Offer Collection Closed, Winner Chosen, and Completed, with side states Rejected by Moderator, Withdrawn, and Offer Deadline Expired. If a Lot receives no Offers, the Customer Company can revise it and send it back to moderation or withdraw it.
_Avoid_: Work execution lifecycle, payment lifecycle

**Material Request**:
A Lot or Estimate Line for construction materials needed for a Primary Contract.
_Avoid_: Product listing, warehouse item

**Service Request**:
A Lot or Estimate Line for construction, installation, repair, logistics, design, or other services performed by an external company or crew.
_Avoid_: Work only, subcontract in all cases

**Equipment Rental Request**:
A Lot or Estimate Line for temporary use of construction equipment with or without an operator.
_Avoid_: Machinery order, asset booking

**Provider**:
A platform participant that can respond to Lots with offers. A Provider can be a legal entity, individual entrepreneur, or individual person.
_Avoid_: Executor as a catch-all, worker in all cases

**Legal Status**:
The formal status under which a Provider operates: legal entity, individual entrepreneur, or individual person.
_Avoid_: Provider type, role

**Offer Profile**:
What a Provider offers commercially on the platform, such as materials, services, equipment rental, leasing, or worker crews. One Provider can have multiple Offer Profiles.
_Avoid_: Legal status, account type

**Assigned Worker**:
An employee or worker attached by a legal-entity Provider as a person who will directly perform service work on a Lot.
_Avoid_: Provider, contractor account

**Leasing Provider**:
A bank or other organization that provides construction equipment through leasing.
_Avoid_: Equipment owner in all cases, rental provider

**Individual Service Provider**:
An individual-person Provider that can respond only to Service Requests.
_Avoid_: Universal provider, material supplier

**Offer**:
A final Provider response to a Lot that states what the Provider can supply or perform, under which price, timeline, and conditions. In the MVP, one Provider can submit only one Offer per Lot, and an Offer cannot be saved as a draft, edited after submission, or withdrawn.
_Avoid_: Bid in all cases, message, application, draft offer, editable offer, duplicate offer

**Offer Template**:
A category-specific structure managed by a Moderator that defines which fields a Provider must complete when submitting an Offer for a Lot.
_Avoid_: Universal response form, free-text message

**Offer Attachment**:
A file attached to an Offer, such as a commercial proposal, certificate, quality passport, license, equipment document, or portfolio material. Offer Attachments are visible to the Customer Company and must not be used to bypass contact restrictions before выбор победителя.
_Avoid_: Direct contact carrier, unstructured replacement for Offer Template, archive upload

**Allowed Attachment Types**:
MVP attachment formats are PDF, DOCX, XLSX, JPG, and PNG. Archive files and executable files are not allowed.
_Avoid_: ZIP, RAR, executable file

**Attachment Size Limits**:
MVP attachments are limited to 25 MB per file and 200 MB total per Lot or Offer.
_Avoid_: Project archive storage, unlimited upload

**Offer Ranking**:
A simple MVP ordering of Offers by submission date. Offers are shown newest first by default, and the Customer Company can change the sort order in the interface.
_Avoid_: Smart ranking, automatic assignment, winner selection

**Offer Export**:
An MVP Excel export of Offers for a Lot so a Customer Company can compare submitted Offers outside the platform.
_Avoid_: Full analytics export, BI reporting

**Выбор победителя**:
The Customer Company's final selection of one or more Offers for a Lot. A Lot can have multiple winning Providers when the Customer Company chooses several Offers. Выбор победителя can happen before the offer deadline and closes offer collection for the Lot.
_Avoid_: Platform decision, automatic distribution

**Deal Package**:
The information bundle created after выбор победителя, including selected Offers, final conditions, documents, contacts, and communication history needed for the parties to continue the deal outside the MVP platform.
_Avoid_: Contract, payment, completed transaction

**Free MVP**:
The first platform version does not charge Customer Companies or Providers for registration, lot publication, offers, выбор победителя, or Deal Package formation.
_Avoid_: Trial plan, commission, paid subscription

**Russian-Only MVP**:
The MVP interface and product content are in Russian only.
_Avoid_: Multilingual interface, localization workflow

**Responsive Web MVP**:
The MVP is a responsive web platform. It does not include native mobile applications.
_Avoid_: Native iOS app, native Android app, desktop-only interface

**Public MVP Pages**:
The pre-auth MVP surface includes the landing page, separate Customer Company registration, separate Provider registration, login, password recovery, email confirmation, user agreement, privacy policy, and contacts. It does not include public Lot or Provider catalogs.
_Avoid_: Public marketplace catalog, public provider directory

**Отзыв после выбора победителя**:
A rating or review that can be left only for a Provider whose Offer was selected through выбор победителя and whose deal with the Customer Company took place. MVP reviews include a 1-10 score, short text, automatic Lot category, automatic date, and automatic Customer Company reference, and are published only after moderation.
_Avoid_: Review before выбор победителя, review for non-selected Provider, public comment

**Review Moderation**:
Manual Moderator review of an Отзыв после выбора победителя before publication to prevent personal data leakage, abusive text, commercial-secret disclosure, or unsupported accusations.
_Avoid_: Immediate review publication, unmoderated rating

**Review Response**:
One public Provider response to a published Отзыв после выбора победителя. The response is published only after Review Moderation and does not create a comment thread.
_Avoid_: Discussion thread, unlimited replies

**Deal Took Place**:
A Customer Company confirmation that a deal with a selected Provider actually took place after выбор победителя. This confirmation enables an Отзыв после выбора победителя for that Provider.
_Avoid_: Provider self-confirmation, automatic completion

**Раскрытие контактов после выбора победителя**:
Прямые контакты исполнителей скрыты до выбора предложения заказчиком. После выбора победителя только заказчику становятся видны контакты всех исполнителей, которые откликнулись на соответствующий Lot; исполнители не видят контакты друг друга.
_Avoid_: Контакты до отклика, контакты только победителя, контакты между исполнителями

**Lot Comment**:
Комментарий или вопрос по Lot до выбора победителя. Customer Company видит все комментарии и ответы по Lot, а Provider видит только свои вопросы и ответы Customer Company на свои вопросы.
_Avoid_: Public chat, direct contact exchange

**Offer Clarification Comment**:
A Lot Comment from a Provider that clarifies a submitted Offer without changing the Offer itself. The Customer Company decides whether to consider the clarification during выбор победителя.
_Avoid_: Offer edit, offer withdrawal, duplicate offer

**Lot Clarification**:
Общее уточнение по Lot, опубликованное Customer Company для всех Providers, которым виден этот Lot. Lot Clarification не раскрывает вопросы или личность конкретного Provider.
_Avoid_: Shared provider question, anonymous public question

**Lot Attachment**:
A file attached to a Lot, such as technical requirements, specifications, schemes, photos, estimate fragments, or other context needed to prepare Offers. Lot Attachments are visible according to Lot-Scoped Visibility and are reviewed during Lot Moderation.
_Avoid_: Full private order file, uncontrolled contact exchange, archive upload

**Moderator**:
A platform employee who manually verifies participants, reviews Lots before publication, and manages category-specific Offer Templates.
_Avoid_: Algorithm, automatic checker

**Administrator**:
A platform employee who manages platform team users, permissions, reference data, system settings, audit access, and disputed account restrictions.
_Avoid_: Moderator, customer admin

**Platform Team Account**:
A Moderator or Administrator account created manually by an Administrator. Platform team roles do not support public self-registration.
_Avoid_: Public moderator signup, self-service admin registration

**Audit Trail**:
The MVP record of key actions such as verification, Lot publication or rejection, Lot changes, Offer submission, выбор победителя, contact disclosure, Deal Took Place confirmation, reviews, review responses, and participant restrictions.
_Avoid_: Debug log, analytics event only

**Operational Metrics**:
MVP platform-team metrics: Customer Companies awaiting verification, Providers awaiting verification, Lots awaiting moderation, reviews awaiting moderation, published Lots, open Lots, Offers submitted, Lots with no Offers, registered Customer Companies, registered Providers, Providers by work category, and average moderation time.
_Avoid_: BI dashboard, financial analytics

**Reference Data**:
Platform-managed catalogs used for estimate normalization, Lot creation, Lot-Provider Fit, moderation, and Offer Templates. MVP Reference Data includes Lot categories, service types, material types, equipment types, regions or service zones, units of measure, category document requirements, Offer Templates, moderation rejection reasons, and participant restriction reasons.
_Avoid_: User tags, free-form categories

**Provider Verification**:
Manual review of a registered Provider by a Moderator before the Provider can view Construction Orders, Lots, or use core platform functionality.
_Avoid_: Self-service activation, optional check

**Provider Registration Data**:
The MVP data required for Provider registration: Legal Status, company name or full name, INN when applicable, region, work or delivery geography, Offer Profiles, contact person, email, phone, password, and verification documents. Legal-entity Providers can add Assigned Workers or crews, and category-specific documents can be added through the Provider profile.
_Avoid_: Public provider listing, anonymous registration

**Verified Provider**:
A Provider that has passed Provider Verification and is allowed to access orders and relevant platform functionality.
_Avoid_: Registered provider, public user

**Исполнитель**:
Пользовательская роль Provider в MVP. Исполнитель управляет профилем, документами и Offer Profiles, видит подходящие Visible Lots, задаёт вопросы через Lot Comments и отправляет Offers.
_Avoid_: Менеджер предложений, менеджер откликов, представитель исполнителя

**Provider Users**:
Multiple users can belong to one legal-entity or individual-entrepreneur Provider in the MVP. Provider users can have the Исполнитель role or the Provider Organization Administrator role. Individual-person Providers do not have a Provider Organization Administrator role.
_Avoid_: Single-user provider only, organization administrator for individual person

**Provider User Invitation**:
A Provider Organization Administrator can invite another user to the same Provider by email. The invited user must confirm email, but the Provider does not repeat Provider Verification, and MVP invitations do not restrict email domains.
_Avoid_: Public join request, repeated provider moderation, email domain restriction

**Provider User Deactivation**:
A Provider Organization Administrator can deactivate a Provider user to remove access while preserving created Offers, comments, profile changes, history, and Audit Trail under the Provider. The author is shown as a deactivated user where needed.
_Avoid_: Hard delete, history removal

**Provider Organization Administrator**:
A Provider user role for legal-entity and individual-entrepreneur Providers that manages users of the same Provider: invitations and deactivation. It does not add business approval powers beyond normal Исполнитель access. Changing the Provider Organization Administrator requires a Provider Organization Administrator Change Request.
_Avoid_: Platform Administrator, Moderator, administrator for individual-person Provider

**Provider Organization Administrator Change Request**:
A request to a Moderator to change the Provider Organization Administrator for a legal-entity or individual-entrepreneur Provider after the first verified organization user is assigned automatically.
_Avoid_: Self-service ownership transfer, support-only informal change

**Provider Profile Visibility**:
A Provider profile is visible to a Customer Company only after that Provider submits an Offer to one of that Customer Company's Lots.
_Avoid_: Public provider catalog, searchable provider directory

**Favorite Provider**:
A Provider marked by a Customer Company as preferred after becoming visible through an Offer or выбор победителя interaction. Favorite status does not bypass Lot-Provider Fit or Lot Moderation and only adds a visual marker in Offer lists.
_Avoid_: Public subscription, searchable provider catalog

**Blocked Provider**:
A Provider marked by a Customer Company as undesirable after becoming visible through an Offer or выбор победителя interaction. A Blocked Provider does not see future Lots from that Customer Company and does not receive Lot Notifications for them, while previous Offers and history remain visible for audit.
_Avoid_: Platform-wide ban, moderation restriction

**Профиль исполнителя до выбора победителя**:
The non-contact Provider profile information visible to a Customer Company after the Provider submits an Offer and before выбор победителя: name, Legal Status, work geography, Offer Profiles, Lot-relevant documents, Отзывы после выбора победителя, experience description, assigned workers or crews when relevant, the structured Offer, and Lot Comments. Direct contacts remain hidden until выбор победителя.
_Avoid_: Contact card, public profile, full provider directory

**Customer Profile Visibility**:
A Customer Company profile is visible to a Provider only when that Provider's Offer has been selected through выбор победителя.
_Avoid_: Pre-offer customer profile, public customer directory

**Customer Contact Disclosure**:
Customer Company contacts become visible to all Providers selected through выбор победителя for the relevant Lot.
_Avoid_: Customer contacts before выбор победителя, contacts for non-selected Providers
