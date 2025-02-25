/************************************************************
 * server.js
 ************************************************************/
const express = require('express')
const cors = require('cors')
const fetch = require('node-fetch')
const { Client } = require('@botpress/chat') // Официальный клиент Botpress
require('dotenv').config()

const app = express()
app.use(cors())
app.use(express.json())

// Хранилище сеансов { sessionId: { userKey, conversationId } }
const sessions = {}

// Пример функции получения короткого ID для user session
function generateSessionId() {
    return Math.random().toString(36).slice(2)
}

// ===== 1) Роут для инициализации сессии: создать user & conversation в Botpress =====
app.post('/api/start-session', async (req, res) => {
    try {
        // Подключаемся к Botpress
        const webhookId = process.env.BOTPRESS_WEBHOOK_ID
        const client = await Client.connect({ webhookId })

        // Создаём conversation
        const { conversation } = await client.createConversation({})
        const conversationId = conversation.id

        // Выдёргиваем userKey (наш клиент)
        //   client.user.key — это то, что Chat Client.connect({ webhookId }) вернёт нам.
        const userKey = client.user.key

        // Создаём sessionId, чтобы в дальнейшем мы могли отличать одного пользователя от другого
        const sessionId = generateSessionId()
        sessions[sessionId] = { userKey, conversationId }

        // Отправляем sessionId на фронт
        res.json({ sessionId })
    } catch (error) {
        console.error('Ошибка при start-session:', error)
        res.status(500).json({ error: 'Failed to start session' })
    }
})

// ===== 2) Роут для отправки текста пользователя в Botpress =====
app.post('/api/sendMessage', async (req, res) => {
    try {
        const { sessionId, userText } = req.body
        if (!sessionId || !userText) {
            return res.status(400).json({ error: 'sessionId и userText обязательны' })
        }

        // Ищем данные сессии
        const sessionData = sessions[sessionId]
        if (!sessionData) {
            return res.status(400).json({ error: 'Сессия не найдена' })
        }

        const webhookId = process.env.BOTPRESS_WEBHOOK_ID
        // Указываем userKey вручную для клиента Botpress
        const client = await Client.connect({
            webhookId,
            user: { // тут вписываем уже имеющийся userKey
                id: sessionData.userKey
            }
        })

        // Отправляем новое сообщение
        await client.createMessage({
            conversationId: sessionData.conversationId,
            payload: {
                type: 'text',
                text: userText
            }
        })

        // Небольшая задержка (или можно слушать SSE, но упростим)
        await new Promise((resolve) => setTimeout(resolve, 1500))

        // Смотрим все сообщения в разговоре
        const { messages } = await client.listMessages({
            conversationId: sessionData.conversationId
        })

        // Последнее сообщение от бота
        //   Бот обычно отвечает последним, но иногда можно смотреть все
        //   и находить среди них сообщение от бота, у которого userId != client.user.id
        let botResponseText = ''
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].userId !== client.user.id) {
                botResponseText = messages[i].payload.text
                break
            }
        }

        // Возвращаем в ответе текст бота
        res.json({ botResponseText })
    } catch (error) {
        console.error('Ошибка при sendMessage:', error)
        res.status(500).json({ error: 'Ошибка при отправке сообщения' })
    }
})

// ===== 3) Роут для создания HeyGen Streaming Token (чтобы не светить API Key на фронте) =====
app.post('/api/get-heygen-token', async (req, res) => {
    try {
        const apiKey = process.env.HEYGEN_API_KEY
        const response = await fetch('https://api.heygen.com/v1/streaming.create_token', {
            method: 'POST',
            headers: { 'x-api-key': apiKey }
        })
        const json = await response.json()
        const token = json.data?.token

        if (!token) {
            return res.status(500).json({ error: 'Не удалось получить HeyGen token' })
        }

        return res.json({ token })
    } catch (error) {
        console.error('Ошибка при получении HeyGen token:', error)
        res.status(500).json({ error: 'Ошибка при get-heygen-token' })
    }
})

// ===== 4) Завершение сессии (при желании) =====
app.post('/api/end-session', (req, res) => {
    try {
        const { sessionId } = req.body
        if (sessionId && sessions[sessionId]) {
            delete sessions[sessionId]
        }
        res.json({ ok: true })
    } catch (error) {
        console.error('Ошибка end-session:', error)
        res.status(500).json({ error: 'Ошибка end-session' })
    }
})


// Запуск сервера
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})
