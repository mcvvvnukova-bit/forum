export const audiences = [
  {
    key: 'customers',
    nav: 'Заказчикам',
    path: '/customers/',
    code: 'PUB.01.01.02',
    title: 'Нужны материалы или исполнители',
    description: 'Разместите потребность, получите предложения и выберите, с кем работать.',
    action: 'Я заказчик',
    steps: ['Опишите заказ.', 'Сравните предложения.', 'Выберите исполнителя.'],
  },
  {
    key: 'suppliers',
    nav: 'Поставщикам и подрядчикам',
    path: '/suppliers/',
    code: 'PUB.01.01.03',
    title: 'Нужны заказы для компании',
    description: 'Находите запросы на ваши товары, работы и услуги. Предлагайте свои условия и участвуйте в тендерах.',
    action: 'Я подрядчик',
    steps: ['Укажите товары, работы или услуги, которые вы поставляете.', 'Найдите подходящий заказ.', 'Отправьте предложение.'],
  },
  {
    key: 'work',
    nav: 'Работа и подработка',
    path: '/work/',
    code: 'PUB.01.01.04',
    title: 'Ищу работу или подработку',
    description: 'Находите отдельные заказы и вакансии на строительных объектах. Выбирайте подходящий вид работы.',
    action: 'Я ищу работу',
    steps: ['Укажите навыки и опыт.', 'Найдите заказ или вакансию.', 'Предложите услуги или откликнитесь.'],
  },
] as const

export const metrics = [
  {value: '28', label: 'открытых заказов'},
  {value: '679 млн', label: 'сумма сделок'},
  {value: '130', label: 'проверенных исполнителей'},
]

export const rules = [
  {
    title: 'Верифицированные участники',
    description: 'Все юридические и физические лица проходят верификацию и проверку разрешений на выполняемые работы.',
  },
  {
    title: 'Проверенные заказы',
    description: 'Все размещаемые заказы проходят проверку перед тем, как они станут доступны подходящим исполнителям.',
  },
  {
    title: 'Отчетность и аналитика',
    description: 'Система формирует отчетность для ЕИС и аналитику для внутреннего использования.',
  },
]

export const faq = [
  {
    question: 'Кто может зарегистрироваться?',
    answer: 'Зарегистрироваться могут юридические лица, ИП и физические лица.',
  },
  {
    question: 'Можно ли посмотреть заказы и участников без регистрации?',
    answer: 'Нет, каталог заказов и данные участников доступны после регистрации и только по вашему профилю.',
  },
  {
    question: 'Как проходит демо?',
    answer: 'Вы записываетесь на удобное время. Вам на почту придёт ссылка на онлайн-встречу. На встрече мы вам покажем возможности платформы и ответим на ваши вопросы.',
  },
]

type Partner = {name: string; file: string; width: number; height: number; caption?: string}

// Asset geometry observed on dev.astforum.ru; UI colors and type remain Primer Light.
export const partners: readonly Partner[] = [
  {name: 'Rentaero', file: 'logo-color-rentaero.svg', width: 149.333, height: 56},
  {name: 'Тахобан', file: 'logo-color-tahoban.svg', width: 179.2, height: 42.279},
  {name: 'Сфера-Снаб', file: 'logo-color-sfera-snab.svg', width: 179.2, height: 40.674},
  {name: 'Спецтранссервис', file: 'logo-color-spectransservice.png', width: 162.791, height: 56},
  {name: 'Tool Tech', file: 'logo-color-tool-tech.jpg', width: 145, height: 74},
  {name: 'ПрофМастер', file: 'logo-color-profmaster.svg', width: 173, height: 32},
  {name: 'Поли-групп', file: 'logo-color-polycorr.svg', width: 105, height: 56},
  {name: 'Зелёная дорога', file: 'logo-color-zelenaya-doroga.png', width: 68, height: 68, caption: 'Зеленая дорога'},
  {name: 'Геопром', file: 'logo-color-geoprom.webp', width: 145.6, height: 72},
  {name: 'ВсеИнструменты.ру', file: 'logo-color-vseinstrumenti.svg', width: 179.2, height: 50.056},
  {name: 'Восток-Сервис', file: 'logo-color-vostok-service.svg', width: 179.2, height: 31.015},
  {name: 'БК-Ресурс', file: 'logo-color-bk-resource.png', width: 111.067, height: 56},
  {name: 'БИН Лизинг', file: 'logo-color-bin-leasing.png', width: 179.2, height: 48.556},
]

export const demo = {
  title: 'Посмотрите, как работает АСТ Форум',
  description: 'Покажем, как размещаются заказы, выбираются поставщики и исполнители работ.',
  followUp: 'Ответим на ваши вопросы.',
  url: 'https://cal.astforum.ru/demo/60min',
}
