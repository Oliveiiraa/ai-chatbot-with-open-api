import { Chat } from '@/components/chat'
import { DEFAULT_PROMPT } from '@/constants/DEFALT_PROMPT'
import { nanoid } from '@/lib/utils'

export default function IndexPage() {
  const id = nanoid()

  return (
    <Chat 
      id={id}
      initialMessages={[{
        id: '',
        role: 'system',
        content: DEFAULT_PROMPT
      }]} 
    />
  )
}
