import {Stack, Text, VisuallyHidden} from '@primer/react'

export function WorkExample({image, title, items}: {image: string; title: string; items: string[]}) {
  return <figure className="example-figure">
    <img className="example-illustration" src={`/audience-assets/media/${image}`} alt="" width="1536" height="1024" loading="lazy" />
    <figcaption><VisuallyHidden><Text weight="semibold">{title}</Text><Stack as="span" role="list" gap="condensed">{items.map(item => <Text role="listitem" key={item}>{item}</Text>)}</Stack></VisuallyHidden></figcaption>
  </figure>
}
